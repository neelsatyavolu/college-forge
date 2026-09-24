import { NextRequest } from "next/server";
import { getShare } from "@/lib/share-store";
import { getWorkspace, updateWorkspace, publicShareView } from "@/lib/store";
import { applyWorkspacePatch } from "@/lib/workspace-patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class ShareUnavailableError extends Error {}

type Ctx = { params: Promise<{ token: string }> };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const share = await getShare(token);
  if (!share || share.revokedAt) {
    return json({ success: false, error: "This share link is invalid or has been revoked." }, 404);
  }
  const ws = await getWorkspace(share.workspaceId);
  if (!ws.shares.some((entry) => entry.token === token && !entry.revokedAt)) {
    return json({ success: false, error: "This share link is invalid or has been revoked." }, 404);
  }
  return json({
    success: true,
    label: share.label,
    createdAt: share.createdAt,
    data: publicShareView(ws),
  });
}

/** Advisors can post notes only (no profile mutation). */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const share = await getShare(token);
  if (!share || share.revokedAt) {
    return json({ success: false, error: "This share link is invalid or has been revoked." }, 404);
  }

  let body: { body?: string; author?: string; essayId?: string; action?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ success: false, error: "A JSON object is required." }, 400);

  if (body.action === "revoke") {
    // Only the owner can revoke via workspace cookie API; ignore here.
    return json({ success: false, error: "Use the hub to revoke shares." }, 403);
  }

  const noteBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!noteBody || noteBody.length > 4000) {
    return json({ success: false, error: "Note must be 1–4000 characters." }, 400);
  }

  try {
    const next = await updateWorkspace(share.workspaceId, (ws) => {
      if (!ws.shares.some((entry) => entry.token === token && !entry.revokedAt)) throw new ShareUnavailableError();
      return applyWorkspacePatch(ws, {
        advisorNote: {
          body: noteBody,
          author: typeof body.author === "string" ? body.author.slice(0, 80) : "Advisor",
          essayId: typeof body.essayId === "string" ? body.essayId : undefined,
        },
      });
    });
    return json({ success: true, data: publicShareView(next) });
  } catch (error) {
    if (error instanceof ShareUnavailableError) return json({ success: false, error: "This share link is invalid or has been revoked." }, 404);
    throw error;
  }
}
