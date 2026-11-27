import { NextRequest } from "next/server";
import { z } from "zod";
import { getWorkspace } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { appOrigin } from "@/lib/origin";
import { createFeed, feedUrls, revokeFeed } from "@/lib/calendar-feed";
import { allow } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The student's calendar subscription link. GET: {data: {https, webcal, createdAt} | null}.
 * POST {action: "create"} makes the link, or replaces it (the old one stops working); {action: "revoke"} ends it.
 */

const Body = z.object({ action: z.enum(["create", "revoke"]) });

function reply(body: { success: boolean; data: unknown; error: string | null }, status = 200, setCookie?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

/** A sibling *.xanom.co page is same-site for the cookie, so writes also check Origin and need a JSON body. */
function crossSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin && origin !== process.env.FORGE_ORIGIN) return true;
  return !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

export async function GET(req: NextRequest) {
  const { id, setCookie } = await getWorkspaceId(req);
  try {
    const ws = await getWorkspace(id);
    return reply({ success: true, data: feedUrls(appOrigin(req), ws), error: null }, 200, setCookie);
  } catch (err) {
    console.error("calendar link read failed", err instanceof Error ? err.name : "unknown");
    return reply({ success: false, data: null, error: "Couldn't load your calendar link. Try again." }, 500, setCookie);
  }
}

export async function POST(req: NextRequest) {
  if (crossSite(req)) return reply({ success: false, data: null, error: "Not allowed." }, 403);
  const parsed = Body.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return reply({ success: false, data: null, error: "Choose create or revoke." }, 400);
  const { id, setCookie } = await getWorkspaceId(req);
  try {
    if (!(await allow(`calendar-link:${id}`, 30, 60 * 60 * 1000))) {
      return reply({ success: false, data: null, error: "Too many changes. Try again in an hour." }, 429, setCookie);
    }
    const ws = parsed.data.action === "create" ? await createFeed(id) : await revokeFeed(id);
    return reply({ success: true, data: feedUrls(appOrigin(req), ws), error: null }, 200, setCookie);
  } catch (err) {
    console.error("calendar link change failed", err instanceof Error ? err.name : "unknown");
    return reply({ success: false, data: null, error: "Couldn't change your calendar link. Try again." }, 500, setCookie);
  }
}
