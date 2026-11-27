import { NextRequest } from "next/server";
import { getWorkspace } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { schoolInsights } from "@/lib/school-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9-]{1,120}$/;

function json(body: unknown, status = 200, setCookie?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

/** GET ?slug=: the personalized numbers for one school on the student's own list (lib/school-detail.ts). */
export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get("slug") ?? "").trim();
  const { id, setCookie } = await getWorkspaceId(req);
  if (!SLUG.test(slug)) return json({ success: false, error: "A school slug is required." }, 400, setCookie);
  try {
    const insights = schoolInsights(await getWorkspace(id), slug);
    if (!insights) return json({ success: false, error: "That school isn't on your list." }, 404, setCookie);
    return json({ success: true, data: insights }, 200, setCookie);
  } catch (error) {
    console.error("[school-detail] failed", error instanceof Error ? error.name : "unknown");
    return json({ success: false, error: "Couldn't load this school's details. Try again." }, 500, setCookie);
  }
}
