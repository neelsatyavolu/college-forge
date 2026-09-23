import { NextRequest } from "next/server";
import { getWorkspace } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { exportPlainText, exportCounselorBrief, exportCalendar } from "@/lib/export";

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
    const calendar = exportCalendar(ws);
    headers["x-calendar-events"] = String(calendar.included);
    headers["x-calendar-skipped"] = String(calendar.skipped);
    return new Response(calendar.text, { headers });
  }

  if (format === "brief" || format === "md") {
    headers["content-type"] = "text/markdown; charset=utf-8";
    headers["content-disposition"] = `attachment; filename="counselor-brief-${name}.md"`;
    return new Response(exportCounselorBrief(ws), { headers });
  }

  if (format !== "txt") return Response.json({ error: "Choose txt, brief, ics, or json." }, { status: 400, headers });
  const essayId = req.nextUrl.searchParams.get("essayId") || undefined;
  if (essayId && !ws.essays.commonApp.some((essay) => essay.id === essayId)) return Response.json({ error: "That essay is no longer available. Refresh and choose again." }, { status: 400, headers });

  // Plain text Common App pack with optional explicit personal-statement choice.
  headers["content-type"] = "text/plain; charset=utf-8";
  headers["content-disposition"] = `attachment; filename="college-forge-export-${name}.txt"`;
  return new Response(exportPlainText(ws, essayId), { headers });
}
