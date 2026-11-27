import { saveLogins, setMasterFor } from "./portal-logins";
import { deleteSetup } from "./portal-setup";
import { deleteLetters } from "./decision-letters";

/**
 * Everything kept outside the workspace for an application, removed with it: its saved login, its use of
 * the master login, a forwarded email's set-up details and its sealed decision letters. Later features add their own per-school data here.
 */
export async function cleanupApps(workspaceId: string, appIds: string[]): Promise<void> {
  if (!appIds.length) return;
  const cleared = Object.fromEntries(appIds.map((id) => [id, null] as const));
  await saveLogins(workspaceId, cleared);
  await setMasterFor(workspaceId, cleared);
  for (const id of appIds) {
    await deleteSetup(workspaceId, id);
    await deleteLetters(workspaceId, id);
  }
}

/** Ids of applications in `before` that `after` no longer has (removed directly or by the list sync). */
export function removedAppIds(before: { tracker: { apps: { id: string }[] } }, after: { tracker: { apps: { id: string }[] } }): string[] {
  const kept = new Set(after.tracker.apps.map((a) => a.id));
  return before.tracker.apps.map((a) => a.id).filter((id) => !kept.has(id));
}
