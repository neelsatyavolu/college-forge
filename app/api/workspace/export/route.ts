import { NextRequest } from "next/server";
import { getWorkspace } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { exportPlainText, exportCounselorBrief, exportIcs } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { id, setCookie } = getWorkspaceId(req);
  const ws = await getWorkspace(id);
  const format = (req.nextUrl.searchParams.get("format") || "txt").toLowerCase();

  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;

  const name = (ws.applicant.name || "student").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40);

  if (format === "json") {
    headers["content-type"] = "application/json; charset=utf-8";
    headers["content-disposition"] = `attachment; filename="college-forge-${name}.json"`;
    return new Response(JSON.stringify(ws, null, 2), { headers });
  }

  if (format === "ics") {
    headers["content-type"] = "text/calendar; charset=utf-8";
    headers["content-disposition"] = `attachment; filename="college-forge-deadlines.ics"`;
    return new Response(exportIcs(ws), { headers });
  }

  if (format === "brief" || format === "md") {
    headers["content-type"] = "text/markdown; charset=utf-8";
    headers["content-disposition"] = `attachment; filename="counselor-brief-${name}.md"`;
    return new Response(exportCounselorBrief(ws), { headers });
  }

  // default: plain text Common App pack
  headers["content-type"] = "text/plain; charset=utf-8";
  headers["content-disposition"] = `attachment; filename="college-forge-export-${name}.txt"`;
  return new Response(exportPlainText(ws), { headers });
}
