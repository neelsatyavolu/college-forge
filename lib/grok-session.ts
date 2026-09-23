import { cookies } from "next/headers";
import { refreshGrokTokens, type GrokTokens } from "./grok-oauth";

const SESSION_COOKIE_PREFIX = "grok_session";
const PKCE_COOKIE = "grok_pkce";
const SESSION_TTL_DAYS = 30;
const PKCE_TTL_SECONDS = 10 * 60;
const CHUNK_SIZE = 3500;
const MAX_CHUNKS = 4;

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

export function writeGrokPkceCookie(value: PkceCookie): void {
  cookies().set(PKCE_COOKIE, JSON.stringify(value), cookieOptions(PKCE_TTL_SECONDS));
}

export function readGrokPkceCookie(): PkceCookie | null {
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

export function clearGrokPkceCookie(): void {
  cookies().delete(PKCE_COOKIE);
}

function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

export function writeGrokSessionCookie(tokens: GrokTokens): void {
  const json = JSON.stringify(tokens);
  const chunks = chunkString(json, CHUNK_SIZE);
  if (chunks.length > MAX_CHUNKS) {
    throw new Error(`Grok session too large to fit in ${MAX_CHUNKS} cookies.`);
  }
  const jar = cookies();
  const opts = cookieOptions(SESSION_TTL_DAYS * 24 * 60 * 60);
  chunks.forEach((chunk, i) => {
    jar.set(`${SESSION_COOKIE_PREFIX}_${i}`, chunk, opts);
  });
  for (let i = chunks.length; i < MAX_CHUNKS; i++) {
    jar.delete(`${SESSION_COOKIE_PREFIX}_${i}`);
  }
}

export function clearGrokSessionCookie(): void {
  const jar = cookies();
  for (let i = 0; i < MAX_CHUNKS; i++) {
    jar.delete(`${SESSION_COOKIE_PREFIX}_${i}`);
  }
}

export function readGrokSessionCookie(): GrokTokens | null {
  const jar = cookies();
  let joined = "";
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const v = jar.get(`${SESSION_COOKIE_PREFIX}_${i}`)?.value;
    if (!v) break;
    joined += v;
  }
  if (!joined) return null;
  try {
    const parsed = JSON.parse(joined);
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    return parsed as GrokTokens;
  } catch {
    return null;
  }
}

export async function getActiveGrokSession(): Promise<GrokTokens | null> {
  const session = readGrokSessionCookie();
  if (!session) return null;
  if (session.expiresAt > Date.now() + 30_000) return session;
  try {
    const refreshed = await refreshGrokTokens(session.refreshToken);
    writeGrokSessionCookie(refreshed);
    return refreshed;
  } catch {
    // A transient refresh outage must not delete a recoverable session. The
    // connection status reports the failure and lets the user retry/reconnect.
    throw new Error("Could not refresh your Grok connection. Retry or reconnect in Settings.");
  }
}
