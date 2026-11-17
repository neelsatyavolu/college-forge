import { randomInt } from "node:crypto";
import { deleteDoc, readDoc, updateDoc, writeDoc } from "./doc-store";
import { sendEmail } from "./email";
import { arrivalEmail, notPortalEmail } from "./notify/inbox-mail";
import { recipientOf } from "./notify/send";
import { openJson, sealJson, type Sealed } from "./portal-logins";
import { addApp, setLogin, updateApp } from "./tracker-service";
import type { PortalResult } from "./tracker";

/**
 * Forwarding portal emails. A student gets a private address on the College Apps mail domain; the College
 * Apps Worker receives what lands there, reads it for a school's account-setup email, sets the portal up
 * where it can, and reports back here. Forge keeps the school and the login; the Worker keeps nothing.
 */

export const INBOX_DOMAIN = "collegeapps.n3el.dev";
/** Forwarded emails per address per UTC day. */
export const MAX_EMAILS_PER_DAY = 20;

/** A portal login found in a forwarded email (same shape as College Apps' web/src/lib/arrival.ts). */
export interface Arrival {
  receivedAt: number;
  collegeId: string | null;
  name: string;
  portalUrl: string;
  username: string;
  password: string;
  /** verified: set and signed in with. set: set, but signing in afterwards failed. todo: nothing changed. */
  state: "verified" | "set" | "todo";
  pin: string;
  link: string;
  reason: string;
  portal?: Omit<PortalResult, "checkedAt" | "ok" | "error">;
}

type Profile = { token: string; birthdate: string; day: string; count: number };
type ArrivalRecord = { workspaceId: string; appId: string; emailed: boolean };

const safe = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
const profileKey = (workspaceId: string) => `inbox-profile/${safe(workspaceId)}.json`;
const tokenKey = (token: string) => `inbox/${token}.json`;
const arrivalKey = (id: string) => `inbox-arrival/${safe(id)}.json`;
const aad = (workspaceId: string) => `forge-inbox:${workspaceId}`;
const TOKEN = /^[a-z0-9]{20}$/;
const ORIGIN = () => (process.env.FORGE_ORIGIN || "https://forge.xanom.co").replace(/\/$/, "");

/** 20 random letters and digits (about 100 bits): the address is the only thing that says whose it is. */
function newToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 20 }, () => chars[randomInt(chars.length)]).join("");
}

async function readProfile(workspaceId: string): Promise<Profile | null> {
  const sealed = await readDoc<Sealed>(profileKey(workspaceId));
  return sealed ? openJson<Profile>(aad(workspaceId), sealed) : null;
}

export type InboxStatus = { address: string | null; birthdate: boolean };

export async function inboxStatus(workspaceId: string): Promise<InboxStatus> {
  const p = await readProfile(workspaceId);
  return { address: p ? `${p.token}@${INBOX_DOMAIN}` : null, birthdate: !!p?.birthdate };
}

/** Turns forwarding on or off, replaces the address, or saves the birthdate some portals ask for. */
export async function setInbox(workspaceId: string, opts: { on: boolean; newAddress?: boolean; birthdate?: string }): Promise<InboxStatus> {
  const current = await readProfile(workspaceId);
  if (!opts.on) {
    if (current) await deleteDoc(tokenKey(current.token));
    await deleteDoc(profileKey(workspaceId));
    return { address: null, birthdate: false };
  }
  const token = !current || opts.newAddress ? newToken() : current.token;
  const birthdate = opts.birthdate !== undefined ? opts.birthdate : (current?.birthdate ?? "");
  const next: Profile = { token, birthdate, day: current?.day ?? "", count: current?.count ?? 0 };
  await writeDoc(tokenKey(token), { workspaceId });
  await writeDoc(profileKey(workspaceId), sealJson(aad(workspaceId), next));
  if (current && current.token !== token) await deleteDoc(tokenKey(current.token));
  return inboxStatus(workspaceId);
}

async function workspaceOf(token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const entry = await readDoc<{ workspaceId: string }>(tokenKey(token));
  if (!entry?.workspaceId) return null;
  // The profile is the authority: a token doc left behind by an interrupted change is ignored.
  const p = await readProfile(entry.workspaceId).catch(() => null);
  return p?.token === token ? entry.workspaceId : null;
}

/** One email arrived for this address. Counts it against the daily limit. Null for an unknown address. */
export async function lookupInbox(token: string, now = Date.now()): Promise<{ email: string; birthdate: string; allowed: boolean } | null> {
  const workspaceId = await workspaceOf(token);
  if (!workspaceId) return null;
  const email = await recipientOf(workspaceId);
  if (!email) return null;
  const day = new Date(now).toISOString().slice(0, 10);
  let allowed = false;
  let birthdate = "";
  await updateDoc<Sealed>(profileKey(workspaceId), (cur) => {
    if (!cur) throw new Error("inbox profile vanished");
    const p = openJson<Profile>(aad(workspaceId), cur);
    const count = p.day === day ? p.count : 0;
    allowed = count < MAX_EMAILS_PER_DAY;
    birthdate = p.birthdate;
    return sealJson(aad(workspaceId), { ...p, day, count: allowed ? count + 1 : count });
  });
  return { email, birthdate, allowed };
}

/**
 * Saves what the Worker found. Called twice per email for a catalog school: once before anything is typed
 * into the portal (so a password set there is never known only to the portal) and once with the outcome.
 * Idempotent by `arrivalId`; the student is emailed once, on the final call.
 */
export async function applyArrival(token: string, arrivalId: string, arrival: Arrival, final: boolean): Promise<boolean> {
  const workspaceId = await workspaceOf(token);
  if (!workspaceId) return false;
  const prior = await readDoc<ArrivalRecord>(arrivalKey(arrivalId));
  if (prior && prior.workspaceId !== workspaceId) return false;
  const app = prior
    ? { id: prior.appId }
    : await addApp(workspaceId, { ...(arrival.collegeId ? { collegeId: arrival.collegeId } : {}), name: arrival.name, portalUrl: arrival.portalUrl });
  if (!prior) await writeDoc(arrivalKey(arrivalId), { workspaceId, appId: app.id, emailed: false } satisfies ArrivalRecord);

  // A "todo" password was never set on the portal, and Forge can't show it, so it isn't saved.
  if (arrival.state !== "todo" && arrival.username && arrival.password) {
    await setLogin(workspaceId, app.id, { username: arrival.username, password: arrival.password });
  }
  if (!final || prior?.emailed) return true;

  const note = arrival.state === "verified" ? "Set up from a forwarded email." : `Set up from a forwarded email: ${arrival.reason}`;
  await updateApp(workspaceId, app.id, (a) => ({ notes: [a.notes, note].filter(Boolean).join("\n\n").slice(0, 4000) }));
  await updateDoc<ArrivalRecord>(arrivalKey(arrivalId), (cur) => ({ ...(cur ?? { workspaceId, appId: app.id }), emailed: true }));
  await tell(workspaceId, arrivalEmail(arrival, ORIGIN()));
  return true;
}

/** The forwarded email wasn't a portal setup email. */
export async function notPortal(token: string, subject: string): Promise<boolean> {
  const workspaceId = await workspaceOf(token);
  if (!workspaceId) return false;
  await tell(workspaceId, notPortalEmail(subject, ORIGIN()));
  return true;
}

/** A failed confirmation email shouldn't lose the login, which is already saved. */
async function tell(workspaceId: string, email: { subject: string; text: string; html: string }): Promise<void> {
  const to = await recipientOf(workspaceId);
  if (!to) return;
  try {
    await sendEmail(to, email);
  } catch (err) {
    console.error("inbox email failed", err instanceof Error ? err.name : "unknown");
  }
}
