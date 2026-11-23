import { createPrivateKey, sign } from "node:crypto";
import http2 from "node:http2";
import { grantExists } from "../oauth";
import { dropTokens, readDevices, setEnvironments, type Device, type PushEnvironment } from "./devices";

/**
 * Apple Push Notification service over HTTP/2 with a token-based (ES256) provider JWT. Without the APNS_*
 * settings this does nothing. Device tokens and the key never reach the logs.
 */

export type ApnsConfig = { keyId: string; teamId: string; privateKey: string; bundleId: string };
export type PushNote = { appId: string; title: string; body: string };
type Reply = { status: number; reason: string };

const HOSTS: Record<PushEnvironment, string> = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
};
/** Apple accepts a provider token for an hour and rejects refreshing it more than every 20 minutes. */
const JWT_TTL_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** The whole push for one workspace, so a stalled APNs can't hold up the sweep. */
const PUSH_DEADLINE_MS = 10_000;
/** Apple says the token is dead. `BadDeviceToken` is different: it also means "wrong host", so that is retried. */
const GONE = new Set(["Unregistered", "DeviceTokenNotForTopic"]);
const TITLE_MAX = 100;

export function apnsConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const privateKey = env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!keyId || !teamId || !privateKey) return null;
  return { keyId, teamId, privateKey, bundleId: env.APNS_BUNDLE_ID?.trim() || "co.xanom.forge" };
}

let cached: { id: string; jwt: string; at: number } | null = null;

/** The provider JWT, reused for 50 minutes. */
export function providerToken(cfg: ApnsConfig, now = Date.now()): string {
  const id = `${cfg.teamId}.${cfg.keyId}`;
  if (cached && cached.id === id && now - cached.at < JWT_TTL_MS) return cached.jwt;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${b64({ alg: "ES256", kid: cfg.keyId })}.${b64({ iss: cfg.teamId, iat: Math.floor(now / 1000) })}`;
  const sig = sign("sha256", Buffer.from(input), { key: createPrivateKey(cfg.privateKey), dsaEncoding: "ieee-p1363" });
  cached = { id, jwt: `${input}.${sig.toString("base64url")}`, at: now };
  return cached.jwt;
}

export function resetTokenCache(): void {
  cached = null;
}

/** Lock-screen text: no control characters, and a title short enough to read. */
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim().slice(0, max);

export function buildPayload(note: PushNote): string {
  return JSON.stringify({
    aps: { alert: { title: clean(note.title, TITLE_MAX), body: clean(note.body, 300) }, sound: "default", "thread-id": note.appId },
    type: "portal_update",
    appId: note.appId,
  });
}

function post(session: http2.ClientHttp2Session, cfg: ApnsConfig, token: string, payload: string): Promise<Reply> {
  return new Promise((resolve) => {
    let req: http2.ClientHttp2Stream;
    try {
      // Throws at once when the session already failed to connect.
      req = session.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${providerToken(cfg)}`,
        "apns-topic": cfg.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      });
    } catch {
      return resolve({ status: 0, reason: "network" });
    }
    let status = 0;
    let body = "";
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.close(http2.constants.NGHTTP2_CANCEL));
    req.on("response", (h) => (status = Number(h[":status"]) || 0));
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("error", () => resolve({ status: 0, reason: "network" }));
    req.on("close", () => {
      let reason = "";
      try {
        reason = body ? String((JSON.parse(body) as { reason?: unknown }).reason ?? "") : "";
      } catch {
        reason = "";
      }
      resolve({ status, reason });
    });
    req.end(payload);
  });
}

let warned = false;

type Outcome = { delivered: Set<string>; gone: Set<string>; moved: Map<string, PushEnvironment> };
type Send = (env: PushEnvironment, token: string, note: PushNote) => Promise<Reply>;

const otherHost = (env: PushEnvironment): PushEnvironment => (env === "sandbox" ? "production" : "sandbox");

/** Devices whose app sign-in still exists. Disconnecting the app (or a dead refresh token) ends its pushes. */
async function liveDevices(devices: Device[]): Promise<Device[]> {
  const live = await Promise.all(devices.map((d) => (d.sub && d.grantId ? grantExists(d.sub, d.grantId) : false)));
  return devices.filter((_, i) => live[i]);
}

/**
 * Sends each note to every live device of the workspace, all at once over one HTTP/2 session per host, within
 * an overall deadline. Returns the app ids that reached at least one device. Never throws: a push problem
 * must not hold up the email or the saved check state.
 */
export async function pushToWorkspace(workspaceId: string, notes: PushNote[], opts: { deadlineMs?: number } = {}): Promise<Set<string>> {
  const delivered = new Set<string>();
  if (!notes.length) return delivered;
  const cfg = apnsConfig();
  if (!cfg) {
    if (!warned) console.info("push notifications off: APNS_* is not configured");
    warned = true;
    return delivered;
  }
  const sessions = new Map<PushEnvironment, http2.ClientHttp2Session>();
  const sessionFor = (env: PushEnvironment) => {
    let s = sessions.get(env);
    if (!s) {
      s = http2.connect(HOSTS[env]);
      s.on("error", () => undefined);
      sessions.set(env, s);
    }
    return s;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let late = false;
  try {
    const { pushEnabled, devices } = await readDevices(workspaceId);
    if (!pushEnabled || !devices.length) return delivered;
    const live = await liveDevices(devices);
    const out: Outcome = { delivered, gone: new Set(devices.filter((d) => !live.includes(d)).map((d) => d.token)), moved: new Map() };
    const send: Send = (env, token, note) => post(sessionFor(env), cfg, token, buildPayload(note));
    const work = Promise.allSettled(live.map((d) => deliver(d, notes, send, out)));
    const deadline = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), opts.deadlineMs ?? PUSH_DEADLINE_MS)));
    late = (await Promise.race([work, deadline])) === "late";
    if (late) console.error("push timed out");
    closeAll(sessions, late);
    if (out.gone.size) await dropTokens(workspaceId, [...out.gone]);
    if (out.moved.size) await setEnvironments(workspaceId, out.moved);
  } catch (err) {
    console.error("push failed", err instanceof Error ? err.name : "unknown");
  } finally {
    clearTimeout(timer);
    closeAll(sessions, true);
  }
  return new Set(delivered);
}

function closeAll(sessions: Map<PushEnvironment, http2.ClientHttp2Session>, now: boolean) {
  for (const s of sessions.values()) {
    try {
      if (now && typeof s.destroy === "function") s.destroy();
      else s.close();
    } catch {
      // Already closed.
    }
  }
  sessions.clear();
}

/** One device: every note on its host; on `BadDeviceToken`, once more on the other host. */
async function deliver(d: Device, notes: PushNote[], send: Send, out: Outcome) {
  let env = d.environment;
  let pending = notes;
  for (let attempt = 0; attempt < 2; attempt++) {
    const replies = await Promise.all(pending.map((n) => send(env, d.token, n)));
    const wrongHost: PushNote[] = [];
    replies.forEach((r, i) => {
      if (r.status === 200) {
        out.delivered.add(pending[i].appId);
        if (env !== d.environment) out.moved.set(d.token, env);
      } else if (r.status === 410 || GONE.has(r.reason)) out.gone.add(d.token);
      else if (r.reason === "BadDeviceToken") wrongHost.push(pending[i]);
      else console.error("push rejected", r.status, r.reason || "no reason");
    });
    if (!wrongHost.length || out.gone.has(d.token)) return;
    env = otherHost(env);
    pending = wrongHost;
  }
  // Both hosts rejected the token.
  if (!out.moved.has(d.token)) out.gone.add(d.token);
}
