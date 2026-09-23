import { NextRequest } from "next/server";
import { getWorkspace } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { recommendColleges } from "@/lib/college-recommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { id, setCookie } = getWorkspaceId(req);
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;
  const data = recommendColleges(await getWorkspace(id));
  return Response.json({ success: true, data }, { headers });
}
