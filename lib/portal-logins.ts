import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { deleteDoc, readDoc, updateDoc } from "./doc-store";

/**
 * Portal usernames and passwords, one encrypted document per workspace (AES-256-GCM, key from
 * PORTAL_LOGINS_KEY). Kept out of the workspace so share links, exports, the AI copilot and MCP never see them.
 * Only the server's portal checker reads them back.
 */

/** `host` is the portal host the login was saved for; checks refuse to send it anywhere else. */
export type PortalLogin = { username: string; password: string; host?: string };
export type Sealed = { v: 1; iv: string; ct: string; tag: string };

function key(): Buffer {
  const raw = process.env.PORTAL_LOGINS_KEY;
  if (!raw) throw new Error("PORTAL_LOGINS_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("PORTAL_LOGINS_KEY must be 32 bytes, base64");
  return k;
}

const docKey = (workspaceId: string) => `logins/${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}.json`;

/**
 * Encrypts a JSON value with PORTAL_LOGINS_KEY. `aad` (such as "forge-logins:<workspace id>") is bound into
 * the ciphertext, so a sealed document can't be moved to another workspace or purpose.
 */
export function sealJson(aad: string, value: unknown): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), ct: ct.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function openJson<T>(aad: string, sealed: Sealed): T {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as T;
}

const seal = (workspaceId: string, value: Record<string, PortalLogin>): Sealed => sealJson(`forge-logins:${workspaceId}`, value);
const open = (workspaceId: string, sealed: Sealed | null): Record<string, PortalLogin> =>
  sealed ? openJson<Record<string, PortalLogin>>(`forge-logins:${workspaceId}`, sealed) : {};

export async function readLogins(workspaceId: string): Promise<Record<string, PortalLogin>> {
  return open(workspaceId, await readDoc<Sealed>(docKey(workspaceId)));
}

/** Sets (or with null, removes) logins by application id. */
export async function saveLogins(workspaceId: string, changes: Record<string, PortalLogin | null>): Promise<void> {
  await updateDoc<Sealed>(docKey(workspaceId), (current) => {
    const next = { ...open(workspaceId, current) };
    for (const [appId, login] of Object.entries(changes)) {
      if (login) next[appId] = { username: login.username.slice(0, 254), password: login.password.slice(0, 256), ...(login.host ? { host: login.host } : {}) };
      else delete next[appId];
    }
    return seal(workspaceId, next);
  });
}

export async function deleteAllLogins(workspaceId: string): Promise<void> {
  await deleteDoc(docKey(workspaceId));
  await deleteDoc(masterKey(workspaceId));
}

// ── The master login ─────────────────────────────────────────────────────────

/**
 * One username and password the student uses on many portals, sealed in its own document (AAD
 * forge-logins-master:<ws>). It's never applied on its own: each school opts in, and the opt-in pins the
 * portal host at that moment, so a school whose portal link moves stops getting it. `failedAt` marks a
 * school where signing in with the master failed; automatic checks stop trying it there (to avoid locking
 * the account) until the master or that school's opt-in changes.
 */
export type MasterUse = { host: string; failedAt?: number };
export type MasterLogin = { username: string; password: string; appIds: Record<string, MasterUse> };

const masterKey = (workspaceId: string) => `logins-master/${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}.json`;
const masterAad = (workspaceId: string) => `forge-logins-master:${workspaceId}`;
const openMaster = (workspaceId: string, sealed: Sealed | null): MasterLogin | null =>
  sealed ? openJson<MasterLogin>(masterAad(workspaceId), sealed) : null;

export async function readMaster(workspaceId: string): Promise<MasterLogin | null> {
  return openMaster(workspaceId, await readDoc<Sealed>(masterKey(workspaceId)));
}

/** Changes the master document in one write; returning null deletes it. */
async function changeMaster(workspaceId: string, change: (current: MasterLogin | null) => MasterLogin | null): Promise<MasterLogin | null> {
  let next: MasterLogin | null = null;
  let remove = false;
  await updateDoc<Sealed | null>(masterKey(workspaceId), (sealed) => {
    next = change(openMaster(workspaceId, sealed));
    remove = !next;
    return next ? sealJson(masterAad(workspaceId), next) : sealed;
  });
  if (remove) await deleteDoc(masterKey(workspaceId));
  return next;
}

/** Sets or replaces the master username and password. Schools keep their opt-in; earlier failures are forgiven. */
export async function saveMaster(workspaceId: string, login: { username: string; password: string }): Promise<MasterLogin> {
  const saved = await changeMaster(workspaceId, (current) => ({
    username: login.username.slice(0, 254),
    password: login.password.slice(0, 256),
    appIds: Object.fromEntries(Object.entries(current?.appIds ?? {}).map(([id, use]) => [id, { host: use.host }])),
  }));
  return saved!;
}

export async function clearMaster(workspaceId: string): Promise<void> {
  await deleteDoc(masterKey(workspaceId));
}

/**
 * Opts schools in (pinning the host) or out (null). `failed` marks a sign-in failure without changing the
 * opt-in; `failed: false` clears one. A school is only opted in while a master exists.
 */
export async function setMasterFor(
  workspaceId: string,
  changes: Record<string, { host: string } | { failed: boolean } | null>,
  opts: { onlyIfPassword?: string } = {},
): Promise<void> {
  if (!Object.keys(changes).length) return;
  const current = await readMaster(workspaceId);
  if (!current) return;
  await changeMaster(workspaceId, (m) => {
    if (!m) return null;
    if (opts.onlyIfPassword !== undefined && m.password !== opts.onlyIfPassword) return m;
    const appIds = { ...m.appIds };
    for (const [id, change] of Object.entries(changes)) {
      if (!change) delete appIds[id];
      else if ("host" in change) appIds[id] = { host: change.host };
      else if (appIds[id]) appIds[id] = change.failed ? { ...appIds[id], failedAt: Date.now() } : { host: appIds[id].host };
    }
    return { ...m, appIds };
  });
}

/**
 * The login to use for a school: its own saved one, or else the master if this school opted in, the portal
 * host is still the one pinned then, and (unless `allowFailed`) the master hasn't failed there.
 */
export function resolveLogin(
  appId: string,
  host: string | null,
  logins: Record<string, PortalLogin>,
  master: MasterLogin | null,
  opts: { allowFailed?: boolean } = {},
): { login: PortalLogin; source: "own" | "master" } | null {
  const own = logins[appId];
  if (own) return { login: own, source: "own" };
  const use = master?.appIds[appId];
  if (!master || !use || !host || use.host !== host) return null;
  if (use.failedAt && !opts.allowFailed) return null;
  return { login: { username: master.username, password: master.password, host: use.host }, source: "master" };
}
