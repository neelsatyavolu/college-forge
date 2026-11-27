import { deleteDoc, readDoc, updateDoc, writeDoc } from "./doc-store";
import { openJson, sealJson, type Sealed } from "./portal-logins";
import { GptzeroError, signIn } from "./gptzero";

/**
 * The student's GPTZero email, password and cached session token: one sealed document per workspace
 * (`gptzero/<ws>.json`, AES-256-GCM with PORTAL_LOGINS_KEY under its own AAD). It lives outside the workspace,
 * so exports, share links, parents, coaches, the copilot and MCP never see it.
 */

/** `failed`: GPTZero refused this login on a fresh sign-in. The password is dropped and nothing calls GPTZero until it's re-entered. */
export type GptzeroLogin = { email: string; password: string; token?: string; tokenExp?: number; failed?: true };

/** Shown wherever a refused login surfaces (Settings and the essay check). */
export const SIGNIN_FAILED = "GPTZero sign-in failed. Re-enter your login in Settings.";

const WORKSPACE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
/** The file name and the AAD use the same id; an id that would need cleaning is refused, never rewritten. */
function checkedId(workspaceId: string): string {
  if (!WORKSPACE_ID.test(workspaceId)) throw new Error("Invalid workspace id for the GPTZero login.");
  return workspaceId;
}
const docKey = (workspaceId: string) => `gptzero/${checkedId(workspaceId)}.json`;
const aad = (workspaceId: string) => `forge-gptzero:${checkedId(workspaceId)}`;

export async function readGptzero(workspaceId: string): Promise<GptzeroLogin | null> {
  const sealed = await readDoc<Sealed>(docKey(workspaceId));
  return sealed ? openJson<GptzeroLogin>(aad(workspaceId), sealed) : null;
}

export async function saveGptzero(workspaceId: string, login: GptzeroLogin): Promise<void> {
  const value: GptzeroLogin = {
    email: login.email.slice(0, 254),
    password: login.password.slice(0, 256),
    ...(login.token ? { token: login.token, tokenExp: login.tokenExp } : {}),
  };
  await writeDoc(docKey(workspaceId), sealJson(aad(workspaceId), value));
}

export async function deleteGptzero(workspaceId: string): Promise<void> {
  await deleteDoc(docKey(workspaceId));
}

/** Keeps a new token only if the same login is still saved (a disconnect or reconnect in between wins). */
async function rememberToken(workspaceId: string, login: GptzeroLogin, token: string, tokenExp: number): Promise<void> {
  await updateDoc<Sealed>(docKey(workspaceId), (cur) => {
    // Throwing leaves the document as it is (or absent, after a disconnect).
    if (!cur) throw new Error("gone");
    const now = openJson<GptzeroLogin>(aad(workspaceId), cur);
    if (now.email !== login.email || now.password !== login.password) throw new Error("changed");
    return sealJson(aad(workspaceId), { ...now, token, tokenExp });
  }).catch(() => undefined);
}

/** Marks the login failed and drops its password, only if the same login is still saved (a reconnect in between wins). */
async function markFailed(workspaceId: string, login: GptzeroLogin): Promise<void> {
  await updateDoc<Sealed>(docKey(workspaceId), (cur) => {
    if (!cur) throw new Error("gone");
    const now = openJson<GptzeroLogin>(aad(workspaceId), cur);
    if (now.email !== login.email || now.password !== login.password) throw new Error("changed");
    return sealJson(aad(workspaceId), { email: now.email, password: "", failed: true });
  }).catch(() => undefined);
}

async function freshToken(workspaceId: string, login: GptzeroLogin): Promise<string> {
  let s;
  try {
    s = await signIn(login.email, login.password);
  } catch (err) {
    if (err instanceof GptzeroError && err.kind === "login") await markFailed(workspaceId, login);
    throw err;
  }
  await rememberToken(workspaceId, login, s.token, s.expiresAt);
  return s.token;
}

/**
 * Runs `fn` with a GPTZero token: the cached one while it's valid, else a new sign-in. A cached token GPTZero
 * refuses gets one new sign-in and one retry. A refused sign-in marks the login failed. Throws GptzeroError("login")
 * when no usable login is saved, without calling GPTZero.
 */
export async function withToken<T>(workspaceId: string, fn: (token: string) => Promise<T>, nowSec = Date.now() / 1000): Promise<T> {
  const login = await readGptzero(workspaceId);
  if (!login || login.failed || !login.password) throw new GptzeroError("login");
  const cached = login.token && (login.tokenExp ?? 0) - 60 > nowSec ? login.token : "";
  if (!cached) return fn(await freshToken(workspaceId, login));
  try {
    return await fn(cached);
  } catch (err) {
    if (!(err instanceof GptzeroError) || err.kind !== "login") throw err;
    return fn(await freshToken(workspaceId, login));
  }
}
