import { deleteDoc, listDocs, readDoc, writeDoc } from "./doc-store";
import { openJson, sealJson, type Sealed } from "./portal-logins";
import type { CleanLetter } from "./decision-letter";

/**
 * Decision letter bodies, one sealed document per posted decision at `letters/<ws>/<appId>.<letterId>.json`.
 * They never go in the workspace document, so exports, share links, parent views, the AI copilot and MCP
 * can't see them. Kept until the school or the workspace is removed.
 */

export interface StoredLetter extends CleanLetter {
  capturedAt: number;
}

const safe = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
const prefix = (workspaceId: string) => `letters/${safe(workspaceId)}/`;
const key = (workspaceId: string, appId: string, letterId: string) => `${prefix(workspaceId)}${safe(appId)}.${safe(letterId)}.json`;
const aad = (workspaceId: string, appId: string) => `forge-letter:${workspaceId}:${appId}`;

export async function saveLetter(workspaceId: string, appId: string, letterId: string, letter: StoredLetter): Promise<void> {
  await writeDoc(key(workspaceId, appId, letterId), sealJson(aad(workspaceId, appId), letter));
}

export async function readLetter(workspaceId: string, appId: string, letterId: string): Promise<StoredLetter | null> {
  const sealed = await readDoc<Sealed>(key(workspaceId, appId, letterId));
  return sealed ? openJson<StoredLetter>(aad(workspaceId, appId), sealed) : null;
}

/** Deletes one school's letters, or with no `appId` every letter in the workspace. */
export async function deleteLetters(workspaceId: string, appId?: string): Promise<void> {
  const base = prefix(workspaceId);
  const keys = await listDocs(base);
  const mine = appId ? keys.filter((k) => k.slice(base.length).startsWith(`${safe(appId)}.`)) : keys;
  for (const k of mine) await deleteDoc(k);
}
