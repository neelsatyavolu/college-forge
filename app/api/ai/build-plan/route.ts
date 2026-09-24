import { NextRequest } from "next/server";
import { getWorkspace } from "@/lib/store";
import { buildPlan } from "@/lib/build-plan";
import { getWorkspaceId } from "@/lib/workspace-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The chat requests the hub build should run next (see lib/build-plan.ts). */
export async function GET(req: NextRequest) {
  const { id, setCookie } = getWorkspaceId(req);
  if (setCookie) {
    return Response.json({ error: "Open your hub first so there is a workspace to build." }, { status: 400 });
  }
  const ws = await getWorkspace(id);
  return Response.json(buildPlan(ws), { headers: { "cache-control": "no-store" } });
}
