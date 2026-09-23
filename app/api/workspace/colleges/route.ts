import { NextRequest } from "next/server";
import { updateWorkspace, type College } from "@/lib/store";
import { upsertCollegeInto, removeCollegeFrom, slugify } from "@/lib/colleges";
import { getWorkspaceId } from "@/lib/workspace-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, setCookie?: string): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

/** Add (or update) a college on the user's list from the Explore page. */
export async function POST(req: NextRequest) {
  const { id, setCookie } = getWorkspaceId(req);

  let body: { college?: Partial<College> };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body." }, 400, setCookie);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ success: false, error: "A JSON object is required." }, 400, setCookie);
  const c = body.college;
  if (!c || typeof c.name !== "string" || !c.name.trim()) {
    return json({ success: false, error: "A college with a name is required." }, 400, setCookie);
  }

  const incoming: College = {
    ...c,
    name: c.name,
    slug: typeof c.slug === "string" && c.slug ? c.slug : slugify(c.name),
    short: typeof c.short === "string" && c.short ? c.short : c.name,
  } as College;

  const next = await updateWorkspace(id, (ws) => upsertCollegeInto(ws, incoming));
  console.log(`[workspace/colleges] ws=${id.slice(0, 8)} added "${incoming.name}" -> ${next.colleges.length} total`);
  return json({ success: true, data: next }, 200, setCookie);
}

/** Remove a college: DELETE /api/workspace/colleges?slug=… */
export async function DELETE(req: NextRequest) {
  const { id, setCookie } = getWorkspaceId(req);
  const slug = (req.nextUrl.searchParams.get("slug") ?? "").trim();
  if (!slug) return json({ success: false, error: "slug is required." }, 400, setCookie);

  const next = await updateWorkspace(id, (ws) => removeCollegeFrom(ws, slug));
  console.log(`[workspace/colleges] ws=${id.slice(0, 8)} removed "${slug}" -> ${next.colleges.length} total`);
  return json({ success: true, data: next }, 200, setCookie);
}
