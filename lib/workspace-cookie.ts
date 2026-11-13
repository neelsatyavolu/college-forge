import type { NextRequest } from "next/server";
import { newWorkspaceId } from "./store";
import { SESSION_COOKIE, ownerOf, readSession, type Session } from "./session";

const COOKIE = "cf_workspace";
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Resolves the anonymous per-browser workspace id from the request cookie,
 * minting a new one (and a Set-Cookie header to persist it) when absent.
 * Keeps every hub visitor on their own private workspace with no login.
 */
export async function getWorkspaceId(req: NextRequest): Promise<{ id: string; setCookie?: string }> {
  // Signed in: the account's workspace, whatever anonymous cookie the browser also has.
  const session = getSession(req);
  if (session) return { id: session.workspaceId };
  const existing = req.cookies.get(COOKIE)?.value;
  // An id that belongs to an account only opens with that account's session.
  if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing) && !(await ownerOf(existing))) {
    return { id: existing };
  }
  const id = newWorkspaceId();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const setCookie = `${COOKIE}=${id}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secure}`;
  return { id, setCookie };
}

/** The signed-in Xanom account, if any. */
export function getSession(req: NextRequest): Session | null {
  return readSession(req.cookies.get(SESSION_COOKIE)?.value);
}

/** The anonymous workspace cookie, if the browser has one. */
export function anonymousWorkspaceId(req: NextRequest): string | null {
  const v = req.cookies.get(COOKIE)?.value;
  return v && /^[a-zA-Z0-9_-]{8,64}$/.test(v) ? v : null;
}
