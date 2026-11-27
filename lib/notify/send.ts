import { createHmac, timingSafeEqual } from "node:crypto";
import { logoUrl } from "../catalog";
import { readDoc, updateDoc } from "../doc-store";
import { sendEmail } from "../email";
import { openJson, sealJson, type Sealed } from "../portal-logins";
import { getAccount, ownerOf } from "../session";
import type { PortalResult, TrackedApp } from "../tracker";
import { pushToWorkspace } from "./apns";
import { changesBetween, composeDigest, pushBody, stateAfter, type Change, type CheckOutcome, type CheckState } from "./changes";

/**
 * Emails a workspace's owner when an automatic check finds something new: one email per sweep that lists
 * every school with news, so a sweep that finds several never sends a burst (Resend allows two a second). The last check's summary per
 * school is kept encrypted beside the workspace (it can hold a decision's wording), and only moves on once
 * the student has been told, so a failed send is retried on the next sweep. Registered iPhones also get a
 * push per school; that skips the email cap and the email switch, and never holds the state back.
 */

/** Emails per workspace per UTC day, as College Apps had. Each sweep sends at most one. */
export const MAX_EMAILS_PER_DAY = 20;

/** `pushed` remembers which pending news already reached the phone, so an email retry doesn't push it again. */
type NotifyState = { apps: Record<string, CheckState>; day: string; count: number; pushed?: Record<string, string> };

const stateKey = (workspaceId: string) => `notify-state/${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}.json`;
const aad = (workspaceId: string) => `forge-notify:${workspaceId}`;
const empty = (): NotifyState => ({ apps: {}, day: "", count: 0 });

function openState(workspaceId: string, sealed: Sealed | null): NotifyState {
  if (!sealed) return empty();
  try {
    return openJson<NotifyState>(aad(workspaceId), sealed);
  } catch {
    return empty(); // The key changed: start a new baseline rather than failing every sweep.
  }
}

/** The owner's email, or null for a workspace no account owns. */
export async function recipientOf(workspaceId: string): Promise<string | null> {
  const sub = await ownerOf(workspaceId);
  if (!sub) return null;
  const account = await getAccount(sub);
  return account?.workspaceId === workspaceId && account.email ? account.email : null;
}

const sign = (workspaceId: string) => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", secret).update(`forge-unsubscribe:${workspaceId}`).digest("base64url");
};

/** A token for the one-click "turn these emails off" link. It doesn't expire. */
export function unsubscribeToken(workspaceId: string): string {
  return `${Buffer.from(workspaceId).toString("base64url")}.${sign(workspaceId)}`;
}

export function readUnsubscribeToken(token: string): string | null {
  const [id64 = "", sig = ""] = token.split(".");
  const workspaceId = Buffer.from(id64, "base64url").toString("utf8");
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(workspaceId)) return null;
  const want = Buffer.from(sign(workspaceId));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? workspaceId : null;
}

type Pending = { app: TrackedApp; changes: Change[]; next: CheckState };

/**
 * Compares each check with the last one and, when `send` is on (an automatic sweep), pushes and emails the
 * owner one email listing every school with news. `email: false` (the student turned emails off) keeps the push.
 * Returns how many emails went out (0 or 1).
 */
export async function notifyChanges(
  workspaceId: string,
  outcomes: Map<string, { app: TrackedApp; outcome: CheckOutcome; before?: PortalResult }>,
  opts: { send: boolean; email?: boolean; now?: number },
): Promise<number> {
  const emailOn = opts.email !== false;
  const now = opts.now ?? Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const before = openState(workspaceId, await readDoc<Sealed>(stateKey(workspaceId)));
  const pending: Pending[] = [];
  for (const [id, { app, outcome, before: shown }] of outcomes) {
    // No summary yet (the first sweep after this shipped, a school brought over from College Apps, or a
    // new key): what the portal showed before this check is the baseline, so old news isn't emailed again.
    const prev = before.apps[id] ?? (shown?.ok ? stateAfter(null, { ok: true, result: shown }) : null);
    const next = stateAfter(prev, outcome);
    pending.push({ app, next, changes: changesBetween(prev, next, outcome.ok ? "" : outcome.message) });
  }

  const told = new Set<string>();
  const used = before.day === day ? before.count : 0;
  let emailed = 0;
  // The push runs beside the emails (it has its own deadline and never throws), so a slow APNs can't delay them.
  const pushing = opts.send ? push(workspaceId, pending, before.pushed ?? {}) : Promise.resolve(new Set<string>());
  const to = opts.send && emailOn && pending.some((p) => p.changes.length) ? await recipientOf(workspaceId) : null;
  const news = pending.filter((p) => p.changes.length);
  if (news.length && to && used < MAX_EMAILS_PER_DAY) {
    try {
      await sendEmail(to, emailFor(workspaceId, news));
      for (const p of news) told.add(p.app.id);
      emailed = 1;
    } catch (err) {
      // Every school keeps its old summary, so the next sweep sends them all again.
      console.error("portal email failed", err instanceof Error ? err.name : "unknown");
    }
  }

  const pushed = await pushing;

  // Without sending (a check the student ran by hand), the student saw the result: it becomes the baseline.
  // When sending, a school whose news didn't go out keeps its old summary so the next sweep tries again.
  // With emails off, the push (or nothing) is all the student gets, so the state moves on as before.
  const moves = (p: Pending) => !opts.send || !emailOn || !p.changes.length || told.has(p.app.id);
  await updateDoc<Sealed>(stateKey(workspaceId), (cur) => {
    const latest = openState(workspaceId, cur);
    const apps = { ...latest.apps };
    const sentPush = { ...(latest.pushed ?? {}) };
    for (const p of pending) {
      if (moves(p)) {
        apps[p.app.id] = p.next;
        delete sentPush[p.app.id];
      } else if (pushed.has(p.app.id)) {
        sentPush[p.app.id] = newsKey(p);
      }
    }
    const base = latest.day === day ? latest.count : 0;
    return sealJson(aad(workspaceId), { apps, day, count: base + emailed, pushed: sentPush });
  });
  return emailed;
}

const newsKey = (p: Pending) => JSON.stringify(p.next);

/** Pushes the schools with news that hasn't reached the phone yet. Returns the app ids it reached. */
async function push(workspaceId: string, pending: Pending[], alreadyPushed: Record<string, string>): Promise<Set<string>> {
  const fresh = pending.filter((p) => p.changes.length && alreadyPushed[p.app.id] !== newsKey(p));
  if (!fresh.length) return new Set();
  return pushToWorkspace(
    workspaceId,
    fresh.map((p) => ({ appId: p.app.id, title: p.app.name, body: pushBody(p.changes) })),
  );
}

const ORIGIN = () => (process.env.FORGE_ORIGIN || "https://forge.xanom.co").replace(/\/$/, "");

function emailFor(workspaceId: string, news: Pending[]) {
  const origin = ORIGIN();
  return composeDigest(
    news.map((p) => {
      const logo = p.app.collegeId ? logoUrl(p.app.collegeId) : undefined;
      return {
        school: p.app.name,
        changes: p.changes,
        ...(logo ? { logo: `${origin}${logo}` } : {}),
      };
    }),
    origin,
    { unsubscribeUrl: `${origin}/api/notify/unsubscribe?t=${encodeURIComponent(unsubscribeToken(workspaceId))}` },
  );
}
