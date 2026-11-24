import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { getWorkspace, needsOnboarding } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = getSession(req);
  // The hub opens the setup wizard by itself for a workspace that has nothing in it yet.
  let onboarding = false;
  if (s) {
    try {
      onboarding = needsOnboarding(await getWorkspace(s.workspaceId));
    } catch (error) {
      // Sign-in state still answers; the hub loads the workspace itself and reports its own errors.
      console.error("api/me: could not read the workspace for the onboarding check", error);
    }
  }
  return Response.json(
    { signedIn: !!s, user: s ? { email: s.email, name: s.name } : null, needsOnboarding: onboarding },
    { headers: { "cache-control": "no-store" } },
  );
}
