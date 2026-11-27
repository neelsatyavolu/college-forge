import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { getWorkspace, needsOnboarding } from "@/lib/store";
import { studentsOf } from "@/lib/parents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = getSession(req);
  // The hub opens the setup wizard by itself for a workspace that has nothing in it yet.
  let onboarding = false;
  // Parents: how many students they follow. `home` is true when the parent dashboard should open instead of
  // the hub: they follow someone and haven't started applications of their own. `counselor` is true when
  // any of them invited this account as their counselor (the dashboard then reads as a counselor's), `coach`
  // when any invited it as their writing coach.
  let students = 0;
  let counselor = false;
  let coach = false;
  if (s) {
    try {
      const followed = await studentsOf(s.sub);
      students = followed.length;
      counselor = followed.some((f) => f.role === "counselor");
      coach = followed.some((f) => f.role === "coach");
    } catch (error) {
      console.error("api/me: could not read parent links", error instanceof Error ? error.name : "unknown");
    }
    try {
      onboarding = needsOnboarding(await getWorkspace(s.workspaceId));
    } catch (error) {
      // Sign-in state still answers; the hub loads the workspace itself and reports its own errors.
      console.error("api/me: could not read the workspace for the onboarding check", error);
    }
  }
  return Response.json(
    {
      signedIn: !!s,
      user: s ? { email: s.email, name: s.name } : null,
      needsOnboarding: onboarding,
      parent: { students, home: students > 0 && onboarding, counselor, ...(coach ? { coach } : {}) },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
