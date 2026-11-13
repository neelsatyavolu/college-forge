import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readDoc, updateDoc } from "./doc-store";

/**
 * Forge accounts are Xanom accounts. Each Xanom `sub` owns exactly one workspace; the signed `forge_session`
 * cookie carries both so every route can find the workspace without a storage read.
 */

export const SESSION_COOKIE = "forge_session";
const MAX_AGE_S = 60 * 60 * 24 * 180;

export type Session = { sub: string; workspaceId: string; email: string; name: string; exp: number };
export type Account = { sub: string; email: string; name: string; workspaceId: string; createdAt: number; lastSignIn: number };

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is not set (32+ characters)");
  return Buffer.from(s);
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (body: string) => createHmac("sha256", secret()).update(`forge-session.${body}`).digest();

export function signSession(s: Omit<Session, "exp">, now = Date.now()): string {
  const body = b64(JSON.stringify({ ...s, exp: Math.floor(now / 1000) + MAX_AGE_S }));
  return `${body}.${b64(mac(body))}`;
}

export function readSession(value: string | undefined, now = Date.now()): Session | null {
  if (!value || value.length > 2000 || !process.env.SESSION_SECRET) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = mac(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Session;
    if (typeof s.sub !== "string" || typeof s.workspaceId !== "string" || s.exp * 1000 < now) return null;
    return s;
  } catch {
    return null;
  }
}

export function sessionCookie(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

const safe = (id: string) => {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new Error("Invalid id");
  return id;
};
const accountKey = (sub: string) => `accounts/${safe(sub)}.json`;
const ownerKey = (workspaceId: string) => `workspace-owner/${safe(workspaceId)}.json`;

export const getAccount = (sub: string) => readDoc<Account>(accountKey(sub));

/**
 * Finds or creates the account for a Xanom user. A first sign-in adopts the browser's anonymous workspace
 * (so what someone did before signing in is kept), unless another account already owns it.
 */
export async function signInAccount(
  user: { sub: string; email: string; name: string },
  anonymousWorkspaceId: string | null,
  now = Date.now(),
): Promise<Account> {
  const existing = await getAccount(user.sub);
  let workspaceId = existing?.workspaceId;
  if (!workspaceId) {
    workspaceId = randomUUID();
    if (anonymousWorkspaceId && /^[a-zA-Z0-9_-]{8,64}$/.test(anonymousWorkspaceId)) {
      const owner = await updateDoc<{ sub: string }>(ownerKey(anonymousWorkspaceId), (cur) => cur ?? { sub: user.sub });
      if (owner.sub === user.sub) workspaceId = anonymousWorkspaceId;
    }
  }
  const ws = workspaceId;
  await updateDoc<{ sub: string }>(ownerKey(ws), (cur) => cur ?? { sub: user.sub });
  return updateDoc<Account>(accountKey(user.sub), (cur) => ({
    sub: user.sub,
    email: user.email,
    name: user.name,
    workspaceId: cur?.workspaceId ?? ws,
    createdAt: cur?.createdAt ?? now,
    lastSignIn: now,
  }));
}

/** Who owns a workspace (for the automatic-check sweep and summaries). */
export async function ownerOf(workspaceId: string): Promise<string | null> {
  return (await readDoc<{ sub: string }>(ownerKey(workspaceId)))?.sub ?? null;
}

/** Short-lived signed link that carries a forge.n3el.dev workspace cookie over to forge.xanom.co. */
export function signHandoff(workspaceId: string, now = Date.now()): string {
  const body = b64(JSON.stringify({ ws: workspaceId, exp: Math.floor(now / 1000) + 120 }));
  return `${body}.${b64(createHmac("sha256", secret()).update(`forge-handoff.${body}`).digest())}`;
}

export function readHandoff(token: string, now = Date.now()): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || !process.env.SESSION_SECRET) return null;
  const expected = createHmac("sha256", secret()).update(`forge-handoff.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { ws: string; exp: number };
    return p.exp * 1000 >= now && /^[a-zA-Z0-9_-]{8,64}$/.test(p.ws) ? p.ws : null;
  } catch {
    return null;
  }
}
