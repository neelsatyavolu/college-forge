import { deleteDoc, readDoc, updateDoc, writeDoc } from "./doc-store";
import { openJson, sealJson, type Sealed } from "./portal-logins";
import { GptzeroError, signIn } from "./gptzero";

/**
 * The student's GPTZero email, password and cached session token: one sealed document per workspace
 * (`gptzero/<ws>.json`, AES-256-GCM with PORTAL_LOGINS_KEY under its own AAD). It lives outside the workspace,
 * so exports, share links, parents, coaches, the copilot and MCP never see it.
 */

export type GptzeroLogin = { email: string; password: string; token?: string; tokenExp?: number };

const cleanId = (workspaceId: string) => workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
const docKey = (workspaceId: string) => `gptzero/${cleanId(workspaceId)}.json`;
const aad = (workspaceId: string) => `forge-gptzero:${workspaceId}`;

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

async function freshToken(workspaceId: string, login: GptzeroLogin): Promise<string> {
  const s = await signIn(login.email, login.password);
  await rememberToken(workspaceId, login, s.token, s.expiresAt);
  return s.token;
}

/**
 * Runs `fn` with a GPTZero token: the cached one while it's valid, else a new sign-in. A cached token GPTZero
 * refuses gets one new sign-in and one retry. Throws GptzeroError("login") when no login is saved.
 */
export async function withToken<T>(workspaceId: string, fn: (token: string) => Promise<T>, nowSec = Date.now() / 1000): Promise<T> {
  const login = await readGptzero(workspaceId);
  if (!login) throw new GptzeroError("login");
  const cached = login.token && (login.tokenExp ?? 0) - 60 > nowSec ? login.token : "";
  if (!cached) return fn(await freshToken(workspaceId, login));
  try {
    return await fn(cached);
  } catch (err) {
    if (!(err instanceof GptzeroError) || err.kind !== "login") throw err;
    return fn(await freshToken(workspaceId, login));
  }
}
