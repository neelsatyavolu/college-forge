import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { deleteDoc, listDocs, readDoc, updateDoc, writeDoc } from "./doc-store";

/**
 * Forge's own OAuth 2.1 authorization server for the MCP endpoint: dynamic client registration (public
 * clients, PKCE S256), authorization codes, 1-hour access tokens and rotating 90-day refresh tokens.
 * The person signs in with Xanom and approves on /oauth/authorize. Only token hashes are stored.
 */

export const SCOPE = "applications";
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 60 * 60 * 24 * 90;
const CODE_TTL_S = 120;

export type Client = { client_id: string; client_name: string; redirect_uris: string[]; created_at: number };
type Code = { client_id: string; redirect_uri: string; code_challenge: string; sub: string; workspaceId: string; grantId: string; exp: number; used?: boolean };
type Token = { kind: "access" | "refresh"; client_id: string; sub: string; workspaceId: string; grantId: string; exp: number; used?: boolean };
export type Grant = { grantId: string; client_id: string; client_name: string; redirect_host: string; created_at: number };

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const token = (bytes = 32) => randomBytes(bytes).toString("base64url");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const safe = (s: string) => /^[A-Za-z0-9_-]{4,120}$/.test(s);
const now = () => Math.floor(Date.now() / 1000);

const clientKey = (id: string) => `oauth-clients/${id}.json`;
const codeKey = (code: string) => `oauth-codes/${hash(code)}.json`;
const tokenKey = (t: string) => `oauth-tokens/${hash(t)}.json`;
const grantKey = (sub: string, grantId: string) => `oauth-grants/${sub}/${grantId}.json`;

/** https anywhere, http only for loopback, or an app's own scheme (cursor://, vscode://); never script-like schemes. */
export function validRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return /^[a-z][a-z0-9+.-]{1,40}:$/.test(u.protocol) && !["javascript:", "data:", "file:", "blob:", "vbscript:", "about:"].includes(u.protocol);
}

export async function registerClient(body: unknown): Promise<Client> {
  const b = (body ?? {}) as { client_name?: unknown; redirect_uris?: unknown };
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10 || uris.some((u) => u.length > 500 || !validRedirectUri(u))) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must be 1-10 https (or loopback http) URLs.");
  }
  const name = typeof b.client_name === "string" && b.client_name.trim() ? b.client_name.trim().slice(0, 80) : "An AI assistant";
  const client: Client = { client_id: `fc_${token(18)}`, client_name: name, redirect_uris: uris, created_at: now() };
  await writeDoc(clientKey(client.client_id), client);
  return client;
}

export async function getClient(id: string | null | undefined): Promise<Client | null> {
  if (!id || !safe(id)) return null;
  return readDoc<Client>(clientKey(id));
}

export type AuthorizeRequest = { client: Client; redirect_uri: string; state: string; code_challenge: string };

/** Validates /oauth/authorize parameters. Errors that can't be sent back to a verified redirect URI are shown. */
export async function checkAuthorize(q: URLSearchParams): Promise<AuthorizeRequest> {
  const client = await getClient(q.get("client_id"));
  if (!client) throw new OAuthError("invalid_client", "This assistant isn't registered with Forge. Try adding the connector again.");
  const redirect_uri = q.get("redirect_uri") ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : "");
  if (!client.redirect_uris.includes(redirect_uri)) throw new OAuthError("invalid_request", "The assistant sent a return address Forge doesn't recognize.");
  if (q.get("response_type") !== "code") throw new OAuthError("unsupported_response_type", "Only response_type=code is supported.");
  const code_challenge = q.get("code_challenge") ?? "";
  if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(code_challenge)) {
    throw new OAuthError("invalid_request", "PKCE with S256 is required.");
  }
  return { client, redirect_uri, state: (q.get("state") ?? "").slice(0, 500), code_challenge };
}

/** Signed consent form token, bound to the signed-in account and the exact request, valid 10 minutes. */
export function consentToken(sub: string, req: AuthorizeRequest): string {
  const body = Buffer.from(JSON.stringify({ sub, c: req.client.client_id, r: req.redirect_uri, s: req.state, p: req.code_challenge, e: now() + 600 })).toString("base64url");
  const sig = createHmac("sha256", process.env.SESSION_SECRET ?? "").update(`forge-consent.${body}`).digest("base64url");
  return `${body}.${sig}`;
}

export function readConsent(t: string, sub: string): { client_id: string; redirect_uri: string; state: string; code_challenge: string } | null {
  const [body, sig] = t.split(".");
  if (!body || !sig || !process.env.SESSION_SECRET) return null;
  const expected = createHmac("sha256", process.env.SESSION_SECRET).update(`forge-consent.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { sub: string; c: string; r: string; s: string; p: string; e: number };
  if (p.sub !== sub || p.e < now()) return null;
  return { client_id: p.c, redirect_uri: p.r, state: p.s, code_challenge: p.p };
}

export async function issueCode(client: Client, redirect_uri: string, code_challenge: string, sub: string, workspaceId: string): Promise<string> {
  const grantId = token(12);
  const host = (() => {
    try {
      return new URL(redirect_uri).host || new URL(redirect_uri).protocol;
    } catch {
      return "";
    }
  })();
  await writeDoc(grantKey(sub, grantId), {
    grantId, client_id: client.client_id, client_name: client.client_name, redirect_host: host, created_at: now(),
  } satisfies Grant);
  const code = token();
  await writeDoc(codeKey(code), { client_id: client.client_id, redirect_uri, code_challenge, sub, workspaceId, grantId, exp: now() + CODE_TTL_S } satisfies Code);
  return code;
}

async function issueTokens(base: Omit<Token, "kind" | "exp">) {
  const access = token();
  const refresh = token();
  await writeDoc(tokenKey(access), { ...base, kind: "access", exp: now() + ACCESS_TTL_S } satisfies Token);
  await writeDoc(tokenKey(refresh), { ...base, kind: "refresh", exp: now() + REFRESH_TTL_S } satisfies Token);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
}

const pkceOk = (verifier: string, challenge: string) =>
  /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && createHash("sha256").update(verifier).digest("base64url") === challenge;

/**
 * Marks a one-time record used with a conditional write, so two racing requests can't both redeem it.
 * Returns the record as it was, or null if it is missing. A record that was already used comes back with
 * `used: true` so the caller can treat it as replay.
 */
async function claim<T extends { used?: boolean }>(key: string): Promise<T | null> {
  let before: T | null = null;
  try {
    await updateDoc<T>(key, (cur) => {
      before = cur;
      if (!cur) throw new OAuthError("invalid_grant", "missing");
      return { ...cur, used: true };
    });
  } catch (err) {
    if (err instanceof OAuthError) return null;
    throw err;
  }
  return before;
}

export async function exchange(form: URLSearchParams) {
  const grant = form.get("grant_type");
  const clientId = form.get("client_id");
  if (grant === "authorization_code") {
    const code = form.get("code") ?? "";
    if (!code || code.length > 200) throw new OAuthError("invalid_request", "code is required.");
    const rec = await claim<Code>(codeKey(code));
    if (!rec || rec.exp < now()) throw new OAuthError("invalid_grant", "The authorization code is invalid or expired.");
    if (rec.used) {
      // A replayed code means it leaked: end everything issued from it (RFC 9700 §4.5).
      await revokeGrant(rec.sub, rec.grantId);
      throw new OAuthError("invalid_grant", "The authorization code is invalid or expired.");
    }
    if ((clientId && clientId !== rec.client_id) || form.get("redirect_uri") !== rec.redirect_uri) {
      throw new OAuthError("invalid_grant", "The code was issued to a different client or redirect URI.");
    }
    if (!pkceOk(form.get("code_verifier") ?? "", rec.code_challenge)) throw new OAuthError("invalid_grant", "PKCE verification failed.");
    return issueTokens({ client_id: rec.client_id, sub: rec.sub, workspaceId: rec.workspaceId, grantId: rec.grantId });
  }
  if (grant === "refresh_token") {
    const rt = form.get("refresh_token") ?? "";
    const rec = rt && rt.length <= 200 ? await claim<Token>(tokenKey(rt)) : null;
    if (!rec || rec.kind !== "refresh" || rec.exp < now() || (clientId && clientId !== rec.client_id)) {
      throw new OAuthError("invalid_grant", "The refresh token is invalid or expired.");
    }
    if (rec.used) {
      // Refresh tokens rotate; seeing an old one again means a copy is in someone else's hands.
      await revokeGrant(rec.sub, rec.grantId);
      throw new OAuthError("invalid_grant", "The refresh token is invalid or expired.");
    }
    if (!(await readDoc<Grant>(grantKey(rec.sub, rec.grantId)))) throw new OAuthError("invalid_grant", "Access was removed in Forge settings.");
    return issueTokens({ client_id: rec.client_id, sub: rec.sub, workspaceId: rec.workspaceId, grantId: rec.grantId });
  }
  throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

/** Resolves a bearer token to the account it acts for; null if it's missing, expired or its grant was removed. */
export async function verifyAccess(authorization: string | null): Promise<{ sub: string; workspaceId: string; grantId: string } | null> {
  const t = authorization?.match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/)?.[1];
  if (!t) return null;
  const rec = await readDoc<Token>(tokenKey(t));
  if (!rec || rec.kind !== "access" || rec.exp < now()) return null;
  // Read only: writing here could recreate a grant that Disconnect deleted a moment ago.
  if (!(await readDoc<Grant>(grantKey(rec.sub, rec.grantId)))) return null;
  return { sub: rec.sub, workspaceId: rec.workspaceId, grantId: rec.grantId };
}

export async function listGrants(sub: string): Promise<Grant[]> {
  if (!safe(sub)) return [];
  const keys = await listDocs(`oauth-grants/${sub}/`);
  const grants = await Promise.all(keys.map((k) => readDoc<Grant>(k).catch(() => null)));
  return grants.filter((g): g is Grant => !!g).sort((a, b) => b.created_at - a.created_at);
}

/** Disconnecting deletes the grant; its tokens stop working on their next use. */
export async function revokeGrant(sub: string, grantId: string): Promise<void> {
  if (safe(sub) && safe(grantId)) await deleteDoc(grantKey(sub, grantId));
}
