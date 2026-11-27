import { randomInt } from "node:crypto";
import { deleteDoc, readDoc, updateDoc, writeDoc } from "./doc-store";
import { sendEmail } from "./email";
import { arrivalEmail, notPortalEmail } from "./notify/inbox-mail";
import { recipientOf } from "./notify/send";
import { openJson, readLogins, readMaster, sealJson, type Sealed } from "./portal-logins";
import { saveSetup } from "./portal-setup";
import { TrackerError, addApp, markSetupWaiting, setLogin, updateApp, useMasterFor } from "./tracker-service";
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

/** One forwarded email in the "Recent forwarded emails" list. Never the PIN, link or password. */
export type RecentArrival = { name: string; state: Arrival["state"]; reason: string; receivedAt: number };
export const MAX_RECENT = 20;

/** `masterForNew`: portals set up from a forwarded email get the master password instead of a generated one. */
type Profile = { token: string; birthdate: string; day: string; count: number; recent?: RecentArrival[]; masterForNew?: boolean };
/**
 * One forwarded email's progress. `placeholder` says the first call saved the new password as the school's
 * login (it had none); otherwise a password the portal may not have yet waits sealed in `pending`, so an
 * existing working login is never replaced before the outcome is known.
 */
type ArrivalRecord = { workspaceId: string; appId: string; emailed: boolean; placeholder?: boolean; pending?: Sealed };

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

export type InboxStatus = { address: string | null; birthdate: boolean; useMasterForNew: boolean; recent: RecentArrival[] };

export async function inboxStatus(workspaceId: string): Promise<InboxStatus> {
  const p = await readProfile(workspaceId);
  return { address: p ? `${p.token}@${INBOX_DOMAIN}` : null, birthdate: !!p?.birthdate, useMasterForNew: !!p?.masterForNew, recent: p?.recent ?? [] };
}

/**
 * Turns forwarding on or off, replaces the address, saves the birthdate some portals ask for, or sets
 * whether new portals get the master password.
 */
export async function setInbox(
  workspaceId: string,
  opts: { on: boolean; newAddress?: boolean; birthdate?: string; useMasterForNew?: boolean },
): Promise<InboxStatus> {
  const current = await readProfile(workspaceId);
  if (!opts.on) {
    if (current) await deleteDoc(tokenKey(current.token));
    await deleteDoc(profileKey(workspaceId));
    return { address: null, birthdate: false, useMasterForNew: false, recent: [] };
  }
  const token = !current || opts.newAddress ? newToken() : current.token;
  const birthdate = opts.birthdate !== undefined ? opts.birthdate : (current?.birthdate ?? "");
  const masterForNew = opts.useMasterForNew !== undefined ? opts.useMasterForNew : !!current?.masterForNew;
  const next: Profile = {
    token,
    birthdate,
    day: current?.day ?? "",
    count: current?.count ?? 0,
    ...(current?.recent?.length ? { recent: current.recent } : {}),
    ...(masterForNew ? { masterForNew } : {}),
  };
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

/**
 * One email arrived for this address. Counts it against the daily limit. Null for an unknown address.
 * `usePassword` is the master password when the student chose it for new portals; the Worker uses it if
 * the school's password rules allow, and generates one otherwise.
 */
export async function lookupInbox(
  token: string,
  now = Date.now(),
): Promise<{ email: string; birthdate: string; allowed: boolean; usePassword?: string } | null> {
  const workspaceId = await workspaceOf(token);
  if (!workspaceId) return null;
  const email = await recipientOf(workspaceId);
  if (!email) return null;
  const day = new Date(now).toISOString().slice(0, 10);
  let allowed = false;
  let birthdate = "";
  let masterForNew = false;
  await updateDoc<Sealed>(profileKey(workspaceId), (cur) => {
    if (!cur) throw new Error("inbox profile vanished");
    const p = openJson<Profile>(aad(workspaceId), cur);
    const count = p.day === day ? p.count : 0;
    allowed = count < MAX_EMAILS_PER_DAY;
    birthdate = p.birthdate;
    masterForNew = !!p.masterForNew;
    return sealJson(aad(workspaceId), { ...p, day, count: allowed ? count + 1 : count });
  });
  const master = masterForNew && allowed ? await readMaster(workspaceId) : null;
  return { email, birthdate, allowed, ...(master ? { usePassword: master.password } : {}) };
}

/** Adds one forwarded email to the capped recent list (newest first). */
async function logArrival(workspaceId: string, entry: RecentArrival): Promise<void> {
  await updateDoc<Sealed>(profileKey(workspaceId), (cur) => {
    if (!cur) throw new Error("inbox profile vanished");
    const p = openJson<Profile>(aad(workspaceId), cur);
    return sealJson(aad(workspaceId), { ...p, recent: [entry, ...(p.recent ?? [])].slice(0, MAX_RECENT) });
  });
}

/** Saves the login a final arrival set: as the master login when it is the master's password, else the school's own. */
async function saveArrivalLogin(workspaceId: string, appId: string, login: { username: string; password: string }): Promise<void> {
  const master = await readMaster(workspaceId);
  if (master && master.password === login.password && master.username === login.username) {
    try {
      await useMasterFor(workspaceId, appId, true);
      return;
    } catch (err) {
      if (!(err instanceof TrackerError)) throw err;
    }
  }
  await setLogin(workspaceId, appId, login);
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
  // Already finished and emailed: a retried or late callback changes nothing.
  if (prior?.emailed) return true;
  const app = prior
    ? { id: prior.appId }
    : await addApp(workspaceId, { ...(arrival.collegeId ? { collegeId: arrival.collegeId } : {}), name: arrival.name, portalUrl: arrival.portalUrl });
  const login = arrival.username && arrival.password ? { username: arrival.username, password: arrival.password } : null;
  const saved = (await readLogins(workspaceId))[app.id];
  const master = await readMaster(workspaceId);

  if (!final) {
    // Before anything is typed into the portal: keep the password, but never over a login that works,
    // whether the school's own or the master login.
    const record: ArrivalRecord = { workspaceId, appId: app.id, emailed: false };
    const working = !!saved || !!master?.appIds[app.id];
    if (login && (!working || prior?.placeholder)) {
      await setLogin(workspaceId, app.id, login);
      record.placeholder = true;
    } else if (login) {
      record.pending = sealJson(aad(workspaceId), login);
    }
    await writeDoc(arrivalKey(arrivalId), record);
    return true;
  }

  if (!prior) await writeDoc(arrivalKey(arrivalId), { workspaceId, appId: app.id, emailed: false } satisfies ArrivalRecord);
  if (arrival.state !== "todo" && login) {
    await saveArrivalLogin(workspaceId, app.id, login);
  } else if (arrival.state === "todo" && prior?.placeholder && saved && login && saved.password === login.password) {
    // The portal never got this password: take the placeholder back off.
    await setLogin(workspaceId, app.id, null);
  }
  if (prior?.pending) await updateDoc<ArrivalRecord>(arrivalKey(arrivalId), (cur) => ({ ...(cur ?? prior), pending: undefined }));

  // Short of verified, keep what the student needs to finish by hand, sealed, instead of throwing it away.
  // The master password is never copied in: the student already knows it, and forgetting it must stick.
  const password = master && arrival.password === master.password ? "" : arrival.password;
  if (arrival.state !== "verified" && (arrival.pin || arrival.link || password)) {
    await saveSetup(workspaceId, app.id, {
      username: arrival.username, password, pin: arrival.pin, link: arrival.link,
      state: arrival.state, reason: arrival.reason, receivedAt: Date.now(),
    });
    await markSetupWaiting(workspaceId, app.id);
  }
  await logArrival(workspaceId, { name: arrival.name, state: arrival.state, reason: arrival.reason.slice(0, 200), receivedAt: Date.now() }).catch((err) => {
    console.error("inbox recent log failed", err instanceof Error ? err.name : "unknown");
  });

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
