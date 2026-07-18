import type { NextRequest } from "next/server";
import { newWorkspaceId } from "./store";

const COOKIE = "cf_workspace";
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Resolves the anonymous per-browser workspace id from the request cookie,
 * minting a new one (and a Set-Cookie header to persist it) when absent.
 * Keeps every hub visitor on their own private workspace with no login.
 */
export function getWorkspaceId(req: NextRequest): { id: string; setCookie?: string } {
  const existing = req.cookies.get(COOKIE)?.value;
  if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
    return { id: existing };
  }
  const id = newWorkspaceId();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const setCookie = `${COOKIE}=${id}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secure}`;
  return { id, setCookie };
}
