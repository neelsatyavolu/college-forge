import { createHmac, timingSafeEqual } from "node:crypto";
import { logoUrl } from "../catalog";
import { readDoc, updateDoc } from "../doc-store";
import { sendEmail } from "../email";
import { openJson, sealJson, type Sealed } from "../portal-logins";
import { getAccount, ownerOf } from "../session";
import type { TrackedApp } from "../tracker";
import { changesBetween, composeEmail, stateAfter, type Change, type CheckOutcome, type CheckState } from "./changes";

/**
 * Emails a workspace's owner when an automatic check finds something new. The last check's summary per
 * school is kept encrypted beside the workspace (it can hold a decision's wording), and only moves on once
 * the student has been told, so a failed send is retried on the next sweep.
 */

/** Emails per workspace per UTC day, as College Apps had. */
export const MAX_EMAILS_PER_DAY = 20;

type NotifyState = { apps: Record<string, CheckState>; day: string; count: number };

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
 * Compares each check with the last one and, when `send` is on, emails the owner one message per school
 * with news. Returns how many emails went out.
 */
export async function notifyChanges(
  workspaceId: string,
  outcomes: Map<string, { app: TrackedApp; outcome: CheckOutcome }>,
  opts: { send: boolean; now?: number },
): Promise<number> {
  const now = opts.now ?? Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const before = openState(workspaceId, await readDoc<Sealed>(stateKey(workspaceId)));
  const pending: Pending[] = [];
  for (const [id, { app, outcome }] of outcomes) {
    const prev = before.apps[id] ?? null;
    const next = stateAfter(prev, outcome);
    pending.push({ app, next, changes: changesBetween(prev, next, outcome.ok ? "" : outcome.message) });
  }

  const told = new Set<string>();
  let used = before.day === day ? before.count : 0;
  const to = opts.send && pending.some((p) => p.changes.length) ? await recipientOf(workspaceId) : null;
  for (const p of pending) {
    if (!p.changes.length || !to || used >= MAX_EMAILS_PER_DAY) continue;
    try {
      await sendEmail(to, emailFor(workspaceId, p));
      told.add(p.app.id);
      used++;
    } catch (err) {
      console.error("portal email failed", err instanceof Error ? err.name : "unknown");
    }
  }

  // Without sending (a check the student ran by hand), the student saw the result: it becomes the baseline.
  // When sending, a school whose news didn't go out keeps its old summary so the next sweep tries again.
  const moves = (p: Pending) => !opts.send || !p.changes.length || told.has(p.app.id);
  await updateDoc<Sealed>(stateKey(workspaceId), (cur) => {
    const latest = openState(workspaceId, cur);
    const apps = { ...latest.apps };
    for (const p of pending) if (moves(p)) apps[p.app.id] = p.next;
    const base = latest.day === day ? latest.count : 0;
    return sealJson(aad(workspaceId), { apps, day, count: base + told.size });
  });
  return told.size;
}

const ORIGIN = () => (process.env.FORGE_ORIGIN || "https://forge.xanom.co").replace(/\/$/, "");

function emailFor(workspaceId: string, p: Pending) {
  const origin = ORIGIN();
  const logo = p.app.collegeId ? logoUrl(p.app.collegeId) : undefined;
  return composeEmail(p.app.name, p.changes, origin, {
    unsubscribeUrl: `${origin}/api/notify/unsubscribe?t=${encodeURIComponent(unsubscribeToken(workspaceId))}`,
    ...(p.app.portalUrl ? { portalUrl: p.app.portalUrl } : {}),
    ...(logo ? { logo: `${origin}${logo}` } : {}),
  });
}
