import { NextRequest } from "next/server";
import { getShare, putShare } from "@/lib/share-store";
import { getWorkspace, saveWorkspace, publicShareView } from "@/lib/store";
import { applyWorkspacePatch } from "@/lib/workspace-patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const token = ctx.params.token;
  const share = await getShare(token);
  if (!share || share.revokedAt) {
    return json({ success: false, error: "This share link is invalid or has been revoked." }, 404);
  }
  const ws = await getWorkspace(share.workspaceId);
  return json({
    success: true,
    label: share.label,
    createdAt: share.createdAt,
    data: publicShareView(ws),
  });
}

/** Advisors can post notes only (no profile mutation). */
export async function POST(req: NextRequest, ctx: Ctx) {
  const token = ctx.params.token;
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

  if (body.action === "revoke") {
    // Only the owner can revoke via workspace cookie API; ignore here.
    return json({ success: false, error: "Use the hub to revoke shares." }, 403);
  }

  const noteBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!noteBody || noteBody.length > 4000) {
    return json({ success: false, error: "Note must be 1–4000 characters." }, 400);
  }

  const ws = await getWorkspace(share.workspaceId);
  const next = applyWorkspacePatch(ws, {
    advisorNote: {
      body: noteBody,
      author: typeof body.author === "string" ? body.author.slice(0, 80) : "Advisor",
      essayId: typeof body.essayId === "string" ? body.essayId : undefined,
    },
  });
  await saveWorkspace(share.workspaceId, next);
  // Touch share last-used by rewriting (no lastUsed field needed)
  await putShare(share);

  return json({ success: true, data: publicShareView(next) });
}
