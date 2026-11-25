import { NextRequest } from "next/server";
import { getWorkspace, updateWorkspace } from "@/lib/store";
import { importCurated, recordAttempt, researchSteps } from "@/lib/research-plan";
import { getWorkspaceId } from "@/lib/workspace-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

async function workspaceIdOrError(req: NextRequest) {
  const { id, setCookie } = await getWorkspaceId(req);
  return setCookie ? null : id;
}

/** The research steps still to run during onboarding (lib/research-plan.ts). */
export async function GET(req: NextRequest) {
  const id = await workspaceIdOrError(req);
  if (!id) return Response.json({ error: "Open your hub first so there is a workspace to research." }, { status: 400 });
  return Response.json({ steps: researchSteps(await getWorkspace(id)) }, { headers: noStore });
}

/**
 * action "start": copy curated research onto the list, then return the steps.
 * action "attempt": a step for `slug` ended; count it (three incomplete steps mark the school for review).
 */
export async function POST(req: NextRequest) {
  const id = await workspaceIdOrError(req);
  if (!id) return Response.json({ error: "Open your hub first so there is a workspace to research." }, { status: 400 });
  let body: { action?: unknown; slug?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (body.action === "start") {
    const ws = await updateWorkspace(id, (w) => importCurated(w));
    return Response.json({ steps: researchSteps(ws) }, { headers: noStore });
  }
  if (body.action === "attempt" && typeof body.slug === "string" && body.slug) {
    const slug = body.slug.slice(0, 120);
    const ws = await updateWorkspace(id, (w) => recordAttempt(w, slug));
    return Response.json({ steps: researchSteps(ws) }, { headers: noStore });
  }
  return Response.json({ error: "Unknown action." }, { status: 400 });
}
