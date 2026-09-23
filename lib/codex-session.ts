import { cookies } from "next/headers";
import { refreshTokens, type CodexTokens } from "./codex-oauth";

const SESSION_COOKIE_PREFIX = "codex_session";
const LEGACY_SESSION_COOKIE = "codex_session";
const PKCE_COOKIE = "codex_pkce";
const SESSION_TTL_DAYS = 30;
const PKCE_TTL_SECONDS = 10 * 60;
const CHUNK_SIZE = 3500;
const MAX_CHUNKS = 6;

type PkceCookie = {
  verifier: string;
  state: string;
};

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge,
});

export function writePkceCookie(value: PkceCookie): void {
  cookies().set(PKCE_COOKIE, JSON.stringify(value), cookieOptions(PKCE_TTL_SECONDS));
}

export function readPkceCookie(): PkceCookie | null {
  const raw = cookies().get(PKCE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.verifier === "string" && typeof parsed.state === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function clearPkceCookie(): void {
  cookies().delete(PKCE_COOKIE);
}

function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

export function writeSessionCookie(tokens: CodexTokens): void {
  const compact: CodexTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    accountId: tokens.accountId,
  };
  const json = JSON.stringify(compact);
  const chunks = chunkString(json, CHUNK_SIZE);
  if (chunks.length > MAX_CHUNKS) {
    throw new Error(`Codex session too large to fit in ${MAX_CHUNKS} cookies.`);
  }
  const jar = cookies();
  const opts = cookieOptions(SESSION_TTL_DAYS * 24 * 60 * 60);
  chunks.forEach((chunk, i) => {
    jar.set(`${SESSION_COOKIE_PREFIX}_${i}`, chunk, opts);
  });
  for (let i = chunks.length; i < MAX_CHUNKS; i++) {
    jar.delete(`${SESSION_COOKIE_PREFIX}_${i}`);
  }
  jar.delete(LEGACY_SESSION_COOKIE);
}

export function clearSessionCookie(): void {
  const jar = cookies();
  for (let i = 0; i < MAX_CHUNKS; i++) {
    jar.delete(`${SESSION_COOKIE_PREFIX}_${i}`);
  }
  jar.delete(LEGACY_SESSION_COOKIE);
}

export function readSessionCookie(): CodexTokens | null {
  const jar = cookies();
  let joined = "";
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const v = jar.get(`${SESSION_COOKIE_PREFIX}_${i}`)?.value;
    if (!v) break;
    joined += v;
  }
  if (!joined) {
    const legacy = jar.get(LEGACY_SESSION_COOKIE)?.value;
    if (legacy) joined = legacy;
  }
  if (!joined) return null;
  try {
    const parsed = JSON.parse(joined);
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string") {
      return null;
    }
    return parsed as CodexTokens;
  } catch {
    return null;
  }
}

export async function getActiveCodexSession(): Promise<CodexTokens | null> {
  const session = readSessionCookie();
  if (!session) return null;
  if (session.expiresAt > Date.now() + 30_000) return session;
  try {
    const refreshed = await refreshTokens(session.refreshToken);
    const merged: CodexTokens = {
      ...refreshed,
      accountId: refreshed.accountId ?? session.accountId,
    };
    writeSessionCookie(merged);
    return merged;
  } catch {
    // A transient refresh outage must not delete a recoverable session. The
    // connection status reports the failure and lets the user retry/reconnect.
    throw new Error("Could not refresh your ChatGPT connection. Retry or reconnect in Settings.");
  }
}
