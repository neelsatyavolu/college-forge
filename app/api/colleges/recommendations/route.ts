import { NextRequest } from "next/server";
import { emptyWorkspace, peekWorkspace } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { recommendColleges } from "@/lib/college-recommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { id, setCookie } = await getWorkspaceId(req);
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;
  // Read only: a visitor without a stored workspace gets recommendations for an empty one, and none is created.
  const data = recommendColleges((await peekWorkspace(id)) ?? emptyWorkspace());
  return Response.json({ success: true, data }, { headers });
}
