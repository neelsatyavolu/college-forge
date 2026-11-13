import { getShare, newShareToken, putShare } from "./share-store";
import { getWorkspace, updateWorkspace, type ShareMeta, type Workspace } from "./store";

/**
 * Share links, used by the hub and by assistants over MCP. A "progress" link shows the applications page
 * (parents, counselors); a "full" link shows the whole hub read-only (advisors). Both can leave notes.
 */

export type ShareScope = "progress" | "full";

export const shareUrl = (origin: string, token: string) => `${origin}/hub/share.html?t=${encodeURIComponent(token)}`;

export async function createShareLink(workspaceId: string, scope: ShareScope, label: string): Promise<{ token: string; workspace: Workspace }> {
  const token = newShareToken();
  const meta: ShareMeta = { token, label: label.trim().slice(0, 60) || (scope === "progress" ? "Progress link" : "Advisor link"), scope, createdAt: Date.now() };
  await putShare({ ...meta, workspaceId });
  const workspace = await updateWorkspace(workspaceId, (ws) => ({
    ...ws,
    shares: [...(ws.shares || []).filter((s) => !s.revokedAt && s.token !== token), meta],
  }));
  return { token, workspace };
}

/** Turns a link off for good. Only links that belong to this workspace are touched. */
export async function revokeShareLink(workspaceId: string, token: string): Promise<Workspace> {
  const existing = await getShare(token);
  if (existing && existing.workspaceId === workspaceId) await putShare({ ...existing, revokedAt: Date.now() });
  return updateWorkspace(workspaceId, (ws) => ({
    ...ws,
    shares: (ws.shares || []).map((s) => (s.token === token ? { ...s, revokedAt: Date.now() } : s)),
  }));
}

export async function activeShareLinks(workspaceId: string): Promise<ShareMeta[]> {
  return ((await getWorkspace(workspaceId)).shares || []).filter((s) => !s.revokedAt);
}
