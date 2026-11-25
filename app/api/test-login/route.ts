import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { signInAccount, signSession, sessionCookie } from "@/lib/session";
import { resetWorkspace } from "@/lib/store";
import { allow, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Signs the owner in as a synthetic test student, for trying Forge end to end on production.
 * Off unless FORGE_TEST_LOGIN_KEY is set. The account is fixed and holds only test data; it can
 * never reach a real student's workspace. `?reset=1` empties it so onboarding starts fresh.
 */
const TEST_USER = { sub: "forge-test-student", email: "test-student@forge.invalid", name: "Test Student" };

function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const expected = process.env.FORGE_TEST_LOGIN_KEY || "";
  if (expected.length < 32) return new Response("Not found", { status: 404 });
  if (!(await allow(`test-login:${clientIp(req)}`, 10, 60 * 60 * 1000))) return new Response("Too many tries. Wait an hour.", { status: 429 });
  const given = req.nextUrl.searchParams.get("key") || "";
  if (!keyMatches(given, expected)) return new Response("Not found", { status: 404 });

  const account = await signInAccount(TEST_USER, null);
  if (req.nextUrl.searchParams.get("reset") === "1") await resetWorkspace(account.workspaceId);
  const session = signSession({ sub: account.sub, workspaceId: account.workspaceId, email: account.email, name: account.name });
  return new Response(null, {
    status: 303,
    headers: { location: new URL("/hub/index.html", req.url).toString(), "set-cookie": sessionCookie(session), "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
