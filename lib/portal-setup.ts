import { deleteDoc, listDocs, readDoc, writeDoc } from "./doc-store";
import { openJson, sealJson, type Sealed } from "./portal-logins";

/**
 * What a forwarded portal set-up email left for the student to finish by hand: the PIN, the activation link
 * and the password Forge generated, when the College Apps Worker couldn't finish (or verify) the set-up.
 * Sealed per school (AAD forge-setup:<ws>:<app id>), readable only by the signed-in student, never part of
 * the workspace, share links, exports, MCP or the copilot. Deleted once a login works, when the school is
 * removed, and treated as gone after 30 days.
 */

export type SetupDetails = {
  username: string;
  password: string;
  pin: string;
  link: string;
  state: "set" | "todo";
  reason: string;
  receivedAt: number;
};

export const SETUP_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const safe = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
const prefix = (workspaceId: string) => `setup/${safe(workspaceId)}/`;
const key = (workspaceId: string, appId: string) => `${prefix(workspaceId)}${safe(appId)}.json`;
const aad = (workspaceId: string, appId: string) => `forge-setup:${workspaceId}:${appId}`;

export async function saveSetup(workspaceId: string, appId: string, details: SetupDetails): Promise<void> {
  await writeDoc(key(workspaceId, appId), sealJson(aad(workspaceId, appId), details));
}

export async function readSetup(workspaceId: string, appId: string, now = Date.now()): Promise<SetupDetails | null> {
  const sealed = await readDoc<Sealed>(key(workspaceId, appId));
  if (!sealed) return null;
  const details = openJson<SetupDetails>(aad(workspaceId, appId), sealed);
  // Saved with the time it was stored, not the email's own date, so a late forward still gets 30 days.
  return now - details.receivedAt > SETUP_TTL_MS ? null : details;
}

export async function deleteSetup(workspaceId: string, appId: string): Promise<void> {
  await deleteDoc(key(workspaceId, appId));
}

export async function deleteAllSetup(workspaceId: string): Promise<void> {
  for (const k of await listDocs(prefix(workspaceId))) await deleteDoc(k);
}
