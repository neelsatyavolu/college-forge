import { collegeById } from "./catalog";
import { latestSlot, normalizeSchedule } from "./check-schedule";
import { readLogins, readMaster, resolveLogin, setMasterFor, type MasterLogin, type PortalLogin } from "./portal-logins";
import { deleteSetup } from "./portal-setup";
import { getWorkspace, updateWorkspace } from "./store";
import { portalDecisionKey, replaceApp, withLetter, withResult, type LetterMeta, type PortalResult, type TrackedApp } from "./tracker";
import { classifyOutcome, cleanLetter, findAwards, letterKey, type IncomingLetter } from "./decision-letter";
import { saveLetter } from "./decision-letters";
import type { CheckErrorCode, CheckOutcome } from "./notify/changes";
import { notifyChanges } from "./notify/send";

/**
 * Portal checks. College Apps' Worker owns the sign-in engine for 330 school portals; Forge calls its
 * service-only endpoint with one login at a time. Nothing about the login is stored there.
 */

const COLLEGEAPPS_URL = "https://collegeapps.n3el.dev";

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
};

export type CheckPlan = { ok: true; url: string } | { ok: false; reason: string };

/** Hosts a catalog school's login may go to: its portal, its sign-in and activation hosts, and its own domains. */
function catalogAllows(college: NonNullable<ReturnType<typeof collegeById>>, host: string): boolean {
  if (host === hostOf(college.loginUrl) || college.hosts.includes(host)) return true;
  return college.domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Only the exact portal hosts the catalog names (its login URL and listed hosts). Anything sourced from a
 * forwarded email is held to this: universities host student and personal pages on their subdomains, so
 * "any *.school.edu" proves nothing about a link in an email.
 */
function catalogExactHost(college: NonNullable<ReturnType<typeof collegeById>>, host: string): boolean {
  return host === hostOf(college.loginUrl) || college.hosts.includes(host);
}

/**
 * True when at least one link is given and every given link is https on one of this catalog school's exact
 * portal hosts. No links proves nothing, so it is false. Not for schools outside the catalog.
 */
export function catalogUrlsAllowed(collegeId: string | null | undefined, urls: string[]): boolean {
  const college = collegeId ? collegeById(collegeId) : undefined;
  const given = urls.filter(Boolean);
  if (!college || !given.length) return false;
  return given.every((u) => {
    const host = hostOf(u);
    return !!host && catalogExactHost(college, host);
  });
}

/**
 * A link from a forwarded email is shown only if it goes to the school: a catalog school's exact portal hosts, or for
 * another school the portal host the student saved. A host that itself came from an email proves nothing.
 */
export function trustedSchoolLink(app: TrackedApp, url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const college = app.collegeId ? collegeById(app.collegeId) : undefined;
  if (college) return catalogExactHost(college, host);
  return !app.portalFromEmail && host === hostOf(app.portalUrl);
}

/** The master login may go to this school only when its portal host didn't come from a forwarded email. */
export const masterAllowed = (app: TrackedApp): boolean => !app.portalFromEmail;

/** Where a portal login for this application may be sent, or null. */
export function loginHost(app: TrackedApp): string | null {
  const college = app.collegeId ? collegeById(app.collegeId) : undefined;
  const own = hostOf(app.portalUrl);
  if (college) return own && catalogAllows(college, own) ? own : hostOf(college.loginUrl);
  return own;
}

/**
 * Every catalog school can be tried; a school added by link only if it's a Slate portal. A login only goes
 * to the host it was saved for: a catalog school's own hosts, or for other schools the exact portal host
 * at the time the login was saved. Changing a portal link afterwards stops checks until the login is saved again.
 */
export function planCheck(app: TrackedApp, login: PortalLogin | undefined): CheckPlan {
  const college = app.collegeId ? collegeById(app.collegeId) : undefined;
  if (!college && app.platform !== "slate") return { ok: false, reason: "This portal can't be checked automatically. Check it by hand." };
  const host = loginHost(app);
  if (!host) return { ok: false, reason: "Add the portal link to check it automatically." };
  if (!login?.username || !login.password) return { ok: false, reason: "Save this portal's username and password to check it automatically." };
  if (!college && login.host !== host) return { ok: false, reason: "The portal link changed since the login was saved. Save the login again to check it." };
  if (college && login.host && login.host !== host && !catalogAllows(college, login.host)) {
    return { ok: false, reason: "The portal link changed since the login was saved. Save the login again to check it." };
  }
  return { ok: true, url: `https://${host}/apply/status` };
}

type Snapshot = Omit<PortalResult, "checkedAt" | "ok" | "error" | "code">;

const CODES: CheckErrorCode[] = ["signin", "mfa", "sso", "not_slate", "unreachable"];

/** A check that failed, with the portal engine's reason. */
class CheckFailure extends Error {
  constructor(message: string, readonly code: CheckErrorCode) {
    super(message);
  }
}

async function callService(app: TrackedApp, url: string, login: PortalLogin): Promise<Snapshot> {
  const key = process.env.FORGE_SERVICE_KEY;
  if (!key) throw new Error("Portal checks aren't set up on this server.");
  const res = await fetch(`${COLLEGEAPPS_URL}/api/service/check`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ collegeId: app.collegeId, url, username: login.username, password: login.password }),
    signal: AbortSignal.timeout(55_000),
  });
  const body = (await res.json().catch(() => ({}))) as { snapshot?: Snapshot; error?: string; code?: string };
  if (res.ok && body.snapshot) return body.snapshot;
  // 422 carries a message written for students ("This portal asks for a Duo push…"); anything else is ours.
  if (res.status === 422 && body.error) {
    throw new CheckFailure(body.error, CODES.includes(body.code as CheckErrorCode) ? (body.code as CheckErrorCode) : "other");
  }
  throw new CheckFailure("Checking that portal failed. Try again in a few minutes.", "unreachable");
}

export async function checkApp(app: TrackedApp, login: PortalLogin | undefined, now = Date.now()): Promise<PortalResult> {
  const failed = (error: string, code: CheckErrorCode = "other"): PortalResult => ({ checkedAt: now, ok: false, error, code, statusText: "", checklist: [], update: "" });
  const plan = planCheck(app, login);
  if (!plan.ok) return failed(plan.reason);
  try {
    const snap = await callService(app, plan.url, login!);
    return {
      checkedAt: now,
      ok: true,
      error: "",
      statusText: snap.statusText,
      checklist: snap.checklist,
      update: snap.update,
      ...(snap.decisionDate ? { decisionDate: snap.decisionDate } : {}),
      ...(snap.round ? { round: snap.round } : {}),
      ...(snap.outcome ? { outcome: snap.outcome } : {}),
      ...(snap.letter ? { letter: snap.letter } : {}),
    };
  } catch (err) {
    if (err instanceof CheckFailure) return failed(err.message, err.code);
    return failed(err instanceof Error && err.name === "TimeoutError" ? "Checking that portal timed out. Try again in a few minutes." : "Couldn't check this portal.", "unreachable");
  }
}

/**
 * Claims the schedule's current slot for an automatic sweep. True once per slot: a second sweep in the same
 * slot (the Worker's hourly ping overlapping the Vercel fallback) gets false, and several missed slots
 * catch up as one. Claimed before checking, so a crash part way skips that slot rather than repeating it.
 */
async function claimSlot(workspaceId: string, now: number): Promise<boolean> {
  let claimed = false;
  await updateWorkspace(workspaceId, (current) => {
    claimed = false;
    if (!current.tracker.autocheck) return current;
    const slot = latestSlot(normalizeSchedule(current.tracker.schedule), now);
    if ((current.tracker.lastSlotAt ?? 0) >= slot) return current;
    claimed = true;
    return { ...current, tracker: { ...current.tracker, lastSlotAt: slot } };
  });
  return claimed;
}

/** Whether an automatic sweep at `now` has a slot to run (without claiming it). */
export function slotOpen(tracker: { schedule?: unknown; lastSlotAt?: number }, now = Date.now()): boolean {
  return (tracker.lastSlotAt ?? 0) < latestSlot(normalizeSchedule(tracker.schedule), now);
}

/**
 * Seals and stores each decision letter a check brought back, keyed by the decision it came with, and
 * returns their metadata by application id. The first letter saved for a decision is kept: a later one never
 * replaces a letter the student may already have opened. A letter that fails to save is dropped; the check
 * itself still counts.
 */
async function storeLetters(
  workspaceId: string,
  apps: TrackedApp[],
  results: Map<string, PortalResult>,
  raw: Map<string, IncomingLetter>,
): Promise<Map<string, LetterMeta>> {
  const metas = new Map<string, LetterMeta>();
  for (const [id, incoming] of raw) {
    const result = results.get(id);
    if (!result?.ok) continue;
    const decisionKey = portalDecisionKey({ portal: result } as TrackedApp);
    const id32 = decisionKey ? letterKey(decisionKey) : "";
    if (!id32 || apps.find((a) => a.id === id)?.letters?.some((l) => l.id === id32)) continue;
    const letter = cleanLetter(incoming);
    if (!letter) continue;
    const meta: LetterMeta = {
      id: id32,
      decisionKey,
      capturedAt: result.checkedAt,
      kind: letter.kind,
      result: classifyOutcome(letter.text),
      awards: findAwards(letter.text),
      seen: false,
    };
    try {
      await saveLetter(workspaceId, id, meta.id, { ...letter, capturedAt: result.checkedAt });
      metas.set(id, meta);
    } catch (err) {
      console.error("decision letter save failed", err instanceof Error ? err.name : "unknown");
    }
  }
  return metas;
}

/**
 * Checks the given applications (or every one with a saved login, its own or the master) a few at a time,
 * then saves all results in one workspace write. Returns the checked applications as saved.
 *
 * `onlyDue` is the automatic sweep: it runs once per schedule slot (lib/check-schedule.ts). Manual checks
 * never read or move the schedule, so checking by hand doesn't push the next automatic check back.
 */
export async function runChecks(
  workspaceId: string,
  opts: { appIds?: string[]; onlyDue?: boolean; concurrency?: number; notify?: boolean } = {},
): Promise<TrackedApp[]> {
  const ws = await getWorkspace(workspaceId);
  // The workspace's own switch is the authority for automatic checks, whatever the sweep's index says.
  if (opts.onlyDue && !ws.tracker.autocheck) return [];
  const now = Date.now();
  if (opts.onlyDue && !slotOpen(ws.tracker, now)) return [];
  const [logins, master] = await Promise.all([readLogins(workspaceId), readMaster(workspaceId)]);
  // A sign-in the master failed on is retried only when the student asks for a check.
  const resolved = new Map<string, { login: PortalLogin; source: "own" | "master" }>();
  for (const a of ws.tracker.apps) {
    const r = resolveLogin(a.id, loginHost(a), logins, masterAllowed(a) ? master : null, { allowFailed: !opts.onlyDue });
    if (r) resolved.set(a.id, r);
  }
  const targets = ws.tracker.apps.filter((a) => (opts.appIds ? opts.appIds.includes(a.id) : resolved.has(a.id)));
  if (!targets.length) return [];
  if (opts.onlyDue && !(await claimSlot(workspaceId, now))) return [];
  const results = new Map<string, PortalResult>();
  const rawLetters = new Map<string, IncomingLetter>();
  const queue = [...targets];
  const worker = async () => {
    for (let app = queue.shift(); app; app = queue.shift()) {
      const { letter, ...result } = await checkApp(app, resolved.get(app.id)?.login);
      results.set(app.id, result);
      if (letter) rawLetters.set(app.id, letter);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, queue.length) }, worker));
  const letters = await storeLetters(workspaceId, targets, results, rawLetters);
  const finished: string[] = [];
  const saved = await updateWorkspace(workspaceId, (current) => {
    let tracker = current.tracker;
    finished.length = 0;
    for (const [id, result] of results) {
      const app = tracker.apps.find((a) => a.id === id);
      if (!app) continue;
      let next = withResult(app, result);
      // A login that works means a forwarded email's set-up details are no longer needed.
      if (result.ok && next.setupWaiting) {
        const { setupWaiting: _s, ...rest } = next;
        next = rest;
        finished.push(id);
      }
      const meta = letters.get(id);
      // Only when this result was the one applied, and its decision is still the one the portal shows.
      // A letter that arrives after the student already opened its decision counts as seen.
      if (meta && next.portal?.checkedAt === result.checkedAt && portalDecisionKey(next) === meta.decisionKey) {
        next = withLetter(next, { ...meta, seen: next.decisionSeen === meta.decisionKey });
      }
      tracker = replaceApp(tracker, next);
    }
    return { ...current, tracker };
  });
  for (const id of finished) await deleteSetup(workspaceId, id).catch(() => undefined);
  await noteMasterOutcomes(workspaceId, results, resolved, master);
  const outcomes = new Map<string, { app: TrackedApp; outcome: CheckOutcome; before?: PortalResult }>();
  for (const [id, result] of results) {
    const app = saved.tracker.apps.find((a) => a.id === id);
    if (!app) continue;
    const outcome: CheckOutcome = result.ok
      ? { ok: true, result }
      : { ok: false, code: (result.code as CheckErrorCode | undefined) ?? "other", message: result.error };
    outcomes.set(id, { app, outcome, before: targets.find((t) => t.id === id)?.portal });
  }
  try {
    await notifyChanges(workspaceId, outcomes, { send: !!opts.notify, email: saved.tracker.emails });
  } catch (err) {
    // The check results are saved; a problem with emails mustn't fail the check.
    console.error("portal change emails failed", err instanceof Error ? err.name : "unknown");
  }
  return saved.tracker.apps.filter((a) => results.has(a.id));
}

/** A wrong master password stops being tried on that portal; a later success there clears the mark. */
async function noteMasterOutcomes(
  workspaceId: string,
  results: Map<string, PortalResult>,
  resolved: Map<string, { source: "own" | "master" }>,
  master: MasterLogin | null,
): Promise<void> {
  if (!master) return;
  const changes: Record<string, { failed: boolean }> = {};
  for (const [id, result] of results) {
    if (resolved.get(id)?.source !== "master") continue;
    if (!result.ok && result.code === "signin") changes[id] = { failed: true };
    else if (result.ok && master.appIds[id]?.failedAt) changes[id] = { failed: false };
  }
  try {
    // Only for the password these checks used: a master replaced meanwhile starts with a clean slate.
    await setMasterFor(workspaceId, changes, { onlyIfPassword: master.password });
  } catch (err) {
    console.error("master login outcome not saved", err instanceof Error ? err.name : "unknown");
  }
}
