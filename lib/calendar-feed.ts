import { deleteDoc, readDoc, writeDoc } from "./doc-store";
import { newShareToken } from "./share-store";
import { peekWorkspace, updateWorkspace, type Workspace } from "./store";

/**
 * A private calendar subscription (webcal) for every dated item in a workspace. The URL's random token is its
 * only credential, so it is never the workspace id (that id is the anonymous cookie). calendars/<token>.json
 * points at the workspace; the workspace's own `calendarFeed` must still name the token, so a reset or a
 * rotation ends old subscriptions even if a stale index file is left behind.
 */

/** newShareToken(): 18 random bytes, base64url. */
export const FEED_TOKEN = /^[A-Za-z0-9_-]{24}$/;

type FeedRecord = { workspaceId: string; createdAt: number };

export type FeedUrls = { https: string; webcal: string; createdAt: number };

/** Only called with tokens this module made or that passed FEED_TOKEN. */
const feedKey = (token: string) => `calendars/${token}.json`;

export function feedUrl(origin: string, token: string): { https: string; webcal: string } {
  const https = `${origin.replace(/\/$/, "")}/api/calendar/${encodeURIComponent(token)}`;
  return { https, webcal: https.replace(/^https?:\/\//, "webcal://") };
}

export function feedUrls(origin: string, ws: Workspace): FeedUrls | null {
  return ws.calendarFeed ? { ...feedUrl(origin, ws.calendarFeed.token), createdAt: ws.calendarFeed.createdAt } : null;
}

/** Creates the feed, or rotates its token. The old link stops working. */
export async function createFeed(workspaceId: string, now = Date.now()): Promise<Workspace> {
  const token = newShareToken();
  await writeDoc(feedKey(token), { workspaceId, createdAt: now } satisfies FeedRecord);
  let previous: string | undefined;
  const ws = await updateWorkspace(workspaceId, (current) => {
    previous = current.calendarFeed?.token;
    return { ...current, calendarFeed: { token, createdAt: now } };
  });
  if (previous && previous !== token) await deleteDoc(feedKey(previous)).catch(() => undefined);
  return ws;
}

/** Turns the feed off. Calendars subscribed to it stop updating (their next refresh gets a 404). */
export async function revokeFeed(workspaceId: string): Promise<Workspace> {
  let previous: string | undefined;
  const ws = await updateWorkspace(workspaceId, (current) => {
    previous = current.calendarFeed?.token;
    const { calendarFeed: _c, ...rest } = current;
    return rest;
  });
  if (previous) await deleteDoc(feedKey(previous)).catch(() => undefined);
  return ws;
}

/** After sign-in copies an anonymous workspace to `workspaceId`, its feed keeps working from the new copy. */
export async function moveFeed(workspaceId: string): Promise<void> {
  const ws = await peekWorkspace(workspaceId);
  const token = ws?.calendarFeed?.token;
  if (!token || !FEED_TOKEN.test(token)) return;
  const rec = await readDoc<FeedRecord>(feedKey(token));
  if (rec) await writeDoc(feedKey(token), { ...rec, workspaceId } satisfies FeedRecord);
}

/**
 * The workspace a feed token opens, or null. Never creates a workspace. A storage failure throws (the route
 * answers 503), so a subscriber doesn't read an outage as a revoked link.
 */
export async function resolveFeed(token: string): Promise<Workspace | null> {
  if (!FEED_TOKEN.test(token)) return null;
  const rec = await readDoc<Partial<FeedRecord>>(feedKey(token));
  if (!rec || typeof rec.workspaceId !== "string" || !rec.workspaceId) return null;
  const ws = await peekWorkspace(rec.workspaceId);
  return ws && ws.calendarFeed?.token === token ? ws : null;
}
