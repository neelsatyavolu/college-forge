import { emailHash } from "./service-auth";
import { logoUrl } from "./catalog";
import { deleteDoc, writeDoc } from "./doc-store";
import { fetchCollegeAppsVault, toTracked } from "./collegeapps-import";
import { clearMaster, readLogins, readMaster, saveLogins, saveMaster, setMasterFor, type PortalLogin } from "./portal-logins";
import { catalogUrlsAllowed, loginHost, masterAllowed, trustedSchoolLink } from "./portal-check";
import { getWorkspace, updateWorkspace, type College, type Scholarship, type Workspace } from "./store";
import { curatedResearchFor, interestOf, interestSignal, upcomingInterviews, type ResearchLike } from "./interest-log";
import { isUntouchedApp } from "./list-sync";
import { deleteSetup, readSetup } from "./portal-setup";
import { canonicalZone, describeSchedule, isEveryHours, isTimeZone, latestSlot, normalizeSchedule, type CheckSchedule } from "./check-schedule";
import { recipientOf } from "./notify/send";
import { classifyOutcome, type LetterAward, type LetterResult } from "./decision-letter";
import { readLetter } from "./decision-letters";
import {
  ADJUSTABLE,
  currentLetter,
  decisionDateOf,
  decisionOf,
  editApp,
  effectiveRound,
  findApp,
  matchCatalog,
  missingItems,
  countedItems,
  isAidItem,
  newApp,
  nextDate,
  replaceApp,
  revealDecision,
  shownPortal,
  statusInfo,
  addFollowUp,
  setFollowUp,
  addFlag,
  resolveFlag,
  todayIso,
  type AppEdit,
  type LetterMeta,
  type StatusId,
  type TrackedApp,
  type Tracker,
} from "./tracker";
import { studentScores, testingPlanFor, withoutWithheldTests, type StudentScores } from "./testing-plan";

/**
 * Everything that reads or changes the tracker goes through here: the hub's API, the AI copilot and the MCP
 * server. Errors thrown as TrackerError carry messages meant for the student (or their assistant).
 */

export class TrackerError extends Error {}

const NO_SCORES: StudentScores = { sat: null, act: null, hasAps: false };

/** The outcome of a revealed decision: the letter's when one was captured, else what the portal's words name. */
function resultOf(app: TrackedApp, portalText: string): LetterResult {
  return currentLetter(app)?.result || classifyOutcome(portalText);
}

/**
 * Letter metadata the student may see: the current letter once its decision is revealed, and earlier letters
 * whose decisions were revealed. Never a letter for a decision still covered.
 */
function lettersShown(app: TrackedApp, revealed: boolean) {
  const current = revealed ? currentLetter(app) : undefined;
  const meta = (l: LetterMeta) => ({ id: l.id, kind: l.kind, capturedAt: l.capturedAt, result: l.result, awards: l.awards });
  return {
    letter: current ? meta(current) : null,
    letterHistory: (app.letters ?? []).filter((l) => l.seen && l.id !== current?.id).map(meta).reverse(),
  };
}

/** What clients see for one application: derived dates, the decision state, and never a password. */
export function viewApp(app: TrackedApp, today = todayIso(), scores: StudentScores = NO_SCORES, research?: ResearchLike | null) {
  const info = statusInfo(app.status);
  const testingPlan = testingPlanFor(app, scores);
  const base = decisionOf(app);
  // `result` is present only once the student revealed the decision.
  const decision = base.state === "revealed" ? { ...base, result: resultOf(app, base.portalText) } : base;
  const portal = shownPortal(app);
  return {
    id: app.id,
    collegeId: app.collegeId,
    slug: app.slug ?? null,
    /** The student took the school off the college list but kept the application. */
    offList: !!app.offList,
    /** Nothing saved yet (Not started, no login, notes or follow-ups): removing it also removes the list school. */
    untouched: isUntouchedApp(app),
    name: app.name,
    logo: app.collegeId ? (logoUrl(app.collegeId) ?? null) : null,
    portalName: app.portalName,
    portalUrl: app.portalUrl,
    // The link came from a forwarded email and the student hasn't saved it: show it, never as a link to open.
    portalFromEmail: !!app.portalFromEmail,
    status: app.status,
    statusLabel: info.label,
    stage: info.stage,
    round: effectiveRound(app),
    roundFromPortal: !app.round && !!app.portal?.round,
    deadline: app.deadline,
    decisionDate: decisionDateOf(app, today),
    // Once a decision is posted, its expected date is no longer news.
    nextDate: decision.state === "hidden" || decision.state === "revealed" ? null : nextDate(app, today),
    decision,
    portal: portal
      ? { checkedAt: portal.checkedAt, ok: portal.ok, error: portal.error, statusText: portal.statusText, update: portal.update, checklist: countedItems(app, portal.checklist) }
      : null,
    missing: withoutWithheldTests(app, missingItems(app, today), testingPlan.policy.kind),
    testingPlan,
    ignoreAid: !!app.ignoreAid,
    hasAidItems: !!app.portal?.checklist.some((c) => isAidItem(c.item)),
    submittedAt: app.submittedAt ?? "",
    followUps: (app.followUps ?? []).filter((f) => !f.done).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")),
    interest: interestOf(app),
    interestSignal: interestSignal(app, research ?? curatedResearchFor(app)),
    lastFailure: app.lastFailure ?? null,
    notes: app.notes,
    decisionNote: app.decisionNote ?? "",
    login: app.login ?? null,
    aidOffer: app.aidOffer ?? null,
    setupWaiting: !!app.setupWaiting,
    ...lettersShown(app, base.state === "revealed"),
    lastChecked: app.lastChecked,
    updatedAt: app.updatedAt,
  };
}
export type AppView = ReturnType<typeof viewApp>;

/** A shortlist school's own research facts, when the workspace has them for this application. */
export const researchOf = (colleges: College[] | undefined, app: TrackedApp): ResearchLike | null =>
  (app.slug ? colleges?.find((c) => c.slug === app.slug)?.research : undefined) ?? null;

/** `revision` is the workspace's; the hub ignores a response older than one it already has. */
/** `colleges` lends each school's workspace research (when it has some) to the interest signal. */
/** needAid: the student's workspace answer; "no" is every school's default until they turn one back on. */
export function viewTracker(tracker: Tracker, today = todayIso(), revision = 0, scores: StudentScores = NO_SCORES, colleges?: College[], needAid?: boolean) {
  // Where each app's chance estimate is saved: its shortlist school's slug, matched as oddsTargets does
  // (lib/admission-odds.ts trackedFor), else "app:<id>". The hub can't redo the catalog match itself.
  const keys = new Map<string, string>();
  for (const c of colleges || []) {
    if (!c.slug) continue;
    const hit = findApp(tracker, c.slug) ?? findApp(tracker, c.name || "");
    if (hit && !keys.has(hit.id)) keys.set(hit.id, c.slug);
  }
  return {
    revision,
    autocheck: tracker.autocheck,
    emails: tracker.emails,
    // When automatic checks run, in the student's time zone. Not in shareTracker: progress links don't get it.
    schedule: describeSchedule(normalizeSchedule(tracker.schedule)),
    flags: tracker.flags.filter((f) => !f.resolvedAt),
    apps: tracker.apps.map((a) => ({ ...viewApp(a.ignoreAid === undefined && needAid === false ? { ...a, ignoreAid: true } : a, today, scores, researchOf(colleges, a)), oddsKey: keys.get(a.id) ?? `app:${a.id}` })),
  };
}

/**
 * What a parent or counselor sees through a progress link: statuses, rounds, dates, follow-ups and flags.
 * No logins, notes, portal links or check errors, and a decision the student hasn't opened shows only as posted.
 * A decision note is shown, since the student writes it for this page, but only once the decision is opened.
 */
export function shareTracker(tracker: Tracker, today = todayIso()) {
  const v = viewTracker(tracker, today);
  return {
    flags: v.flags.map(({ id, text, scope }) => ({ id, text, scope })),
    apps: v.apps.map((a) => ({
      id: a.id, name: a.name, logo: a.logo, status: a.status, statusLabel: a.statusLabel, stage: a.stage,
      round: a.round, deadline: a.deadline, submittedAt: a.submittedAt, decisionDate: a.decisionDate, nextDate: a.nextDate,
      decision: a.decision.state === "hidden" ? { state: "hidden" as const, portalText: "" } : { state: a.decision.state, portalText: a.decision.portalText },
      decisionNote: a.decision.state === "hidden" ? "" : a.decisionNote,
      portal: a.portal && a.portal.ok ? { checkedAt: a.portal.checkedAt, statusText: a.portal.statusText, update: a.portal.update } : null,
      missing: a.missing, followUps: a.followUps.map(({ id, text, due }) => ({ id, text, due })),
    })),
  };
}

const autocheckKey = (workspaceId: string) => `autocheck/${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`;

/** Keeps the sweep's index in step: listed while automatic checks are on and some login is saved. */
async function syncAutocheckIndex(workspaceId: string, _after?: Tracker): Promise<void> {
  // Re-read rather than trust the caller's copy, so a slower request can't restore an index entry a newer one removed.
  // The sweep also checks the workspace's own switch, so a stale entry never causes a check.
  const { tracker } = await getWorkspace(workspaceId);
  const wanted = tracker.autocheck && tracker.apps.some((a) => a.login?.hasPassword);
  if (wanted) await writeDoc(autocheckKey(workspaceId), { workspaceId });
  else await deleteDoc(autocheckKey(workspaceId));
}

function mustFind(tracker: Tracker, ref: string): TrackedApp {
  const app = findApp(tracker, ref);
  if (!app) throw new TrackerError(`No application matches "${ref}". Use list_applications to see the schools.`);
  return app;
}

async function mutate(workspaceId: string, change: (tracker: Tracker, ws: Workspace) => Tracker): Promise<Workspace> {
  try {
    return await updateWorkspace(workspaceId, (ws) => ({ ...ws, tracker: change(ws.tracker, ws) }));
  } catch (err) {
    if (err instanceof Error && err.message && /^(Unknown|Deadline|Decision|Portal|No application|No follow-up|No flag|Already|Write what|Due date|Submitted date|Testing|Aid )/.test(err.message)) {
      throw new TrackerError(err.message);
    }
    throw err;
  }
}

export async function listApps(workspaceId: string) {
  const ws = await getWorkspace(workspaceId);
  return viewTracker(ws.tracker, todayIso(), ws.revision, studentScores(ws), ws.colleges, ws.onboarding.listPrefs?.needAid);
}

export async function addApp(
  workspaceId: string,
  input: { name?: string; collegeId?: string; slug?: string; portalUrl?: string; portalFromEmail?: boolean } & AppEdit,
): Promise<AppView> {
  const name = (input.name ?? "").trim();
  if (!name && !input.collegeId) throw new TrackerError("Give the school's name.");
  let createdId = "";
  const ws = await mutate(workspaceId, (tracker, current) => {
    const catalog = input.collegeId ? matchCatalog(input.collegeId) : matchCatalog(name);
    const dup = tracker.apps.find(
      (a) => (catalog && a.collegeId === catalog.id) || (input.slug && a.slug === input.slug) || a.name.toLowerCase() === name.toLowerCase(),
    );
    if (dup) {
      createdId = dup.id;
      // An untouched application (often the one the list sync made for a list school) takes the details given now.
      const { name: _dn, collegeId: _dc, slug: _ds, portalUrl: dupUrl, portalFromEmail: dupFromEmail, ...dupEdit } = input;
      // A forwarded email never replaces a link the school already has. Otherwise, as for a new school below:
      // a catalog school keeps it only on its own hosts, and any other school's link is marked as the email's.
      const dupLink = dupFromEmail && dupUrl && (dup.portalUrl || (dup.collegeId && !catalogUrlsAllowed(dup.collegeId, [dupUrl]))) ? undefined : dupUrl;
      const dupMark = dupLink ? { portalUrl: dupLink, ...(dupFromEmail && !dup.collegeId ? { portalFromEmail: true } : {}) } : {};
      const filled = isUntouchedApp(dup) && (Object.keys(dupEdit).length || dupLink)
        ? editApp({ ...dup, ...dupMark }, dupEdit)
        : dup;
      // Linking a shortlist school to an application someone already added by name.
      const linked = input.slug && !filled.slug ? { ...filled, slug: input.slug } : filled;
      return linked === dup ? tracker : replaceApp(tracker, linked);
    }
    const slug = input.slug ?? current.colleges.find((c) => catalog && matchCatalog(c.name)?.id === catalog.id)?.slug;
    const { name: _n, collegeId: _c, slug: _s, portalUrl: given, portalFromEmail, ...edit } = input;
    // An emailed link for a catalog school is kept only on that school's own hosts; otherwise its catalog login URL.
    const portalUrl = portalFromEmail && catalog && given && !catalogUrlsAllowed(catalog.id, [given]) ? undefined : given;
    const base = newApp({ name: name || catalog?.name || "", collegeId: catalog?.id ?? null, slug, portalUrl });
    // A catalog school's hosts are known; any other school's link from an email is only the email's word.
    const marked = portalFromEmail && !base.collegeId && base.portalUrl ? { ...base, portalFromEmail: true } : base;
    const app = editApp(marked, edit);
    createdId = app.id;
    return { ...tracker, apps: [...tracker.apps, app] };
  });
  return viewApp(ws.tracker.apps.find((a) => a.id === createdId)!, todayIso(), studentScores(ws));
}

/**
 * Edits one application. `edit` may be a function of the current application, so changes that depend on it
 * (appending a note) are computed inside the same write. Moving the portal to a different host forgets the
 * saved login, so a password is never sent somewhere it wasn't saved for.
 */
export async function updateApp(workspaceId: string, ref: string, edit: AppEdit | ((app: TrackedApp) => AppEdit)): Promise<AppView> {
  let id = "";
  let dropLogin = false;
  const ws = await mutate(workspaceId, (tracker) => {
    const app = mustFind(tracker, ref);
    id = app.id;
    const change = typeof edit === "function" ? edit(app) : edit;
    let next = editApp(app, change);
    // The student (or their copilot) saving a new link vouches for it, whatever a forwarded email said.
    // Saving another field with the same link vouches for nothing.
    if (next.portalFromEmail && next.portalUrl !== app.portalUrl) {
      const { portalFromEmail: _f, ...rest } = next;
      next = rest;
    }
    dropLogin = !!app.login && loginHost(next) !== loginHost(app);
    if (dropLogin) {
      const { login: _l, ...rest } = next;
      next = rest;
    }
    return replaceApp(tracker, next);
  });
  if (dropLogin) {
    await saveLogins(workspaceId, { [id]: null });
    await setMasterFor(workspaceId, { [id]: null });
    await syncAutocheckIndex(workspaceId, ws.tracker);
  }
  return viewApp(ws.tracker.apps.find((a) => a.id === id)!, todayIso(), studentScores(ws));
}

export async function removeApp(workspaceId: string, ref: string): Promise<{ removed: string }> {
  let removed: TrackedApp | undefined;
  const ws = await mutate(workspaceId, (tracker) => {
    removed = mustFind(tracker, ref);
    return { ...tracker, apps: tracker.apps.filter((a) => a.id !== removed!.id) };
  });
  // The store's write (lib/app-cleanup.ts) already removed its login, master use, set-up details and decision letters.
  await syncAutocheckIndex(workspaceId, ws.tracker);
  return { removed: removed!.name };
}

/**
 * Opens a posted decision. Its outcome is recorded as the status at the same time while the application is
 * still pending (up to Under review, or deferred or waitlisted), never over admitted, committed, denied or withdrawn.
 */
export async function reveal(workspaceId: string, ref: string): Promise<AppView> {
  let id = "";
  const ws = await mutate(workspaceId, (tracker) => {
    const app = mustFind(tracker, ref);
    id = app.id;
    // Only the first opening records anything, so a repeated reveal can't undo the student's correction.
    if (decisionOf(app).state !== "hidden") return tracker;
    const opened = revealDecision(app);
    const result = resultOf(opened, decisionOf(opened).portalText);
    const open = ADJUSTABLE.includes(app.status) || app.status === "deferred" || app.status === "waitlisted";
    return replaceApp(tracker, result && open ? editApp(opened, { status: result as StatusId }) : opened);
  });
  return viewApp(ws.tracker.apps.find((a) => a.id === id)!, todayIso(), studentScores(ws));
}

/** A letter's body, only for a decision the student revealed. `letterId` picks an earlier letter. */
export async function getLetter(workspaceId: string, ref: string, letterId?: string) {
  const app = mustFind((await getWorkspace(workspaceId)).tracker, ref);
  const revealed = decisionOf(app).state === "revealed";
  const meta = letterId ? app.letters?.find((l) => l.id === letterId) : revealed ? currentLetter(app) : undefined;
  const allowed = !!meta && (meta.seen || (revealed && meta.decisionKey === app.decisionSeen));
  const letter = allowed ? await readLetter(workspaceId, app.id, meta!.id) : null;
  if (!meta || !letter) throw new TrackerError("No saved letter for that decision. Open the portal to read it.");
  return {
    id: meta.id,
    kind: letter.kind,
    text: letter.text,
    ...(letter.html ? { html: letter.html } : {}),
    ...(letter.pdfBase64 ? { pdfBase64: letter.pdfBase64 } : {}),
    capturedAt: letter.capturedAt,
    result: meta.result,
    awards: meta.awards,
  };
}

/**
 * Adds one award from a revealed letter to the scholarships list as won, as a school award. The id is
 * fixed per award, so adding it twice changes nothing.
 */
export async function addLetterAward(workspaceId: string, ref: string, index: number, letterId?: string) {
  let added: Scholarship | undefined;
  const ws = await updateWorkspace(workspaceId, (current) => {
    const app = mustFind(current.tracker, ref);
    const shown = lettersShown(app, decisionOf(app).state === "revealed");
    const letter = letterId ? [shown.letter, ...shown.letterHistory].find((l) => l?.id === letterId) : shown.letter;
    const award: LetterAward | undefined = letter?.awards[index];
    if (!letter || !award) throw new TrackerError("That award isn't in a letter you've opened.");
    const id = `letter-${app.id}-${letter.id}-${index}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
    added = current.scholarships.find((s) => s.id === id) ?? {
      id,
      name: award.name,
      ...(award.amount ? { amount: [award.amount, award.period].filter(Boolean).join(" ") } : {}),
      status: "won",
      notes: `From ${app.name}'s decision letter`,
      ...(app.slug ? { slug: app.slug } : {}),
      kind: "school",
    };
    if (current.scholarships.some((s) => s.id === id)) return current;
    return { ...current, scholarships: [...current.scholarships, added] };
  });
  return { scholarship: added!, scholarships: ws.scholarships };
}

/** Saves (or with null, forgets) one school's portal login. Only the username is ever shown back. */
export async function setLogin(workspaceId: string, ref: string, login: PortalLogin | null): Promise<AppView> {
  if (login && (!login.username.trim() || !login.password)) throw new TrackerError("Enter both the portal username and password.");
  const current = mustFind((await getWorkspace(workspaceId)).tracker, ref);
  if (login && !masterAllowed(current)) {
    throw new TrackerError("This portal link came from a forwarded email. Check it and save it yourself before saving its login.");
  }
  const host = loginHost(current);
  if (login && !host) throw new TrackerError("Add the portal link before saving its login.");
  await saveLogins(workspaceId, { [current.id]: login ? { username: login.username.trim(), password: login.password, host: host! } : null });
  // A school's own login overrides the master login; forgetting the login forgets both.
  await setMasterFor(workspaceId, { [current.id]: null });
  if (login) await deleteSetup(workspaceId, current.id);
  const ws = await mutate(workspaceId, (tracker) => {
    const app = tracker.apps.find((a) => a.id === current.id);
    if (!app) return tracker;
    const { login: _old, setupWaiting, ...rest } = app;
    const next = login
      ? { ...rest, login: { username: login.username.trim(), hasPassword: true } }
      : { ...rest, ...(setupWaiting ? { setupWaiting } : {}) };
    return replaceApp(tracker, { ...next, updatedAt: Date.now() });
  });
  await syncAutocheckIndex(workspaceId, ws.tracker);
  return viewApp(ws.tracker.apps.find((a) => a.id === current.id)!, todayIso(), studentScores(ws));
}

/** Marks that a forwarded email left set-up details for this school (lib/portal-setup.ts holds them). */
export async function markSetupWaiting(workspaceId: string, appId: string): Promise<void> {
  await mutate(workspaceId, (tracker) => {
    const app = tracker.apps.find((a) => a.id === appId);
    return app ? replaceApp(tracker, { ...app, setupWaiting: true, updatedAt: Date.now() }) : tracker;
  });
}

/** A forwarded email's PIN, link and password for one school, for the signed-in student only. */
export async function setupDetails(workspaceId: string, ref: string) {
  const app = mustFind((await getWorkspace(workspaceId)).tracker, ref);
  const details = app.setupWaiting ? await readSetup(workspaceId, app.id) : null;
  if (!details) {
    if (app.setupWaiting) {
      // Expired (30 days) or gone: stop offering it.
      await deleteSetup(workspaceId, app.id);
      await mutate(workspaceId, (tracker) => {
        const current = tracker.apps.find((a) => a.id === app.id);
        if (!current?.setupWaiting) return tracker;
        const { setupWaiting: _s, ...rest } = current;
        return replaceApp(tracker, { ...rest, updatedAt: Date.now() });
      });
    }
    throw new TrackerError("There are no set-up details waiting for this school.");
  }
  // Checked again on the way out: clients show a link only when the server says it goes to the school.
  const linkChecked = !!details.link && trustedSchoolLink(app, details.link);
  return { ...details, link: linkChecked ? details.link : "", linkChecked };
}

// ── The master login ────────────────────────────────────────────────────────

/** What clients see about the master login: never the password. */
export async function masterStatus(workspaceId: string) {
  const master = await readMaster(workspaceId);
  return { on: !!master, username: master?.username ?? "", appCount: master ? Object.keys(master.appIds).length : 0 };
}
export type MasterStatus = Awaited<ReturnType<typeof masterStatus>>;

/** Mirrors the master's use into the workspace, so the hub and the sweep's index see a login. */
function mirrorMaster(tracker: Tracker, appIds: Set<string>, username: string | null): Tracker {
  return {
    ...tracker,
    apps: tracker.apps.map((a) => {
      if (appIds.has(a.id) && username !== null) return { ...a, login: { username, hasPassword: true, source: "master" as const }, updatedAt: Date.now() };
      if (a.login?.source === "master" && (username === null || !appIds.has(a.id))) {
        const { login: _l, ...rest } = a;
        return { ...rest, updatedAt: Date.now() };
      }
      return a;
    }),
  };
}

/**
 * Sets, replaces or (with null) forgets the master login. The username defaults to the account's email.
 * Replacing it keeps every school's opt-in, so change it here only after changing it on those portals.
 */
export async function setMasterLogin(workspaceId: string, login: { username: string; password: string } | null) {
  if (!login) {
    await clearMaster(workspaceId);
    const ws = await mutate(workspaceId, (tracker) => mirrorMaster(tracker, new Set(), null));
    await syncAutocheckIndex(workspaceId, ws.tracker);
    return masterStatus(workspaceId);
  }
  const username = login.username.trim() || (await recipientOf(workspaceId)) || "";
  if (!username || !login.password) throw new TrackerError("Enter the master username and password.");
  const saved = await saveMaster(workspaceId, { username, password: login.password });
  const ws = await mutate(workspaceId, (tracker) => mirrorMaster(tracker, new Set(Object.keys(saved.appIds)), username));
  await syncAutocheckIndex(workspaceId, ws.tracker);
  return masterStatus(workspaceId);
}

/**
 * Turns the master login on or off for one school. On pins the portal host as it is now and replaces the
 * school's own saved login; it needs a master and a portal link.
 */
export async function useMasterFor(workspaceId: string, ref: string, on: boolean): Promise<AppView> {
  const app = mustFind((await getWorkspace(workspaceId)).tracker, ref);
  if (on) {
    const master = await readMaster(workspaceId);
    if (!master) throw new TrackerError("Save a master login first.");
    if (!masterAllowed(app)) throw new TrackerError("This portal link came from a forwarded email. Check it and save it yourself before using the master login here.");
    const host = loginHost(app);
    if (!host) throw new TrackerError("Add the portal link before using the master login here.");
    // Opt in first and confirm it stuck (the master could be forgotten meanwhile) before dropping the own login.
    await setMasterFor(workspaceId, { [app.id]: { host } });
    if (!(await readMaster(workspaceId))?.appIds[app.id]) throw new TrackerError("Save a master login first.");
    await saveLogins(workspaceId, { [app.id]: null });
    const ws = await mutate(workspaceId, (tracker) => {
      const current = tracker.apps.find((a) => a.id === app.id);
      return current ? replaceApp(tracker, { ...current, login: { username: master.username, hasPassword: true, source: "master" }, updatedAt: Date.now() }) : tracker;
    });
    await syncAutocheckIndex(workspaceId, ws.tracker);
    return viewApp(ws.tracker.apps.find((a) => a.id === app.id)!, todayIso(), studentScores(ws));
  }
  await setMasterFor(workspaceId, { [app.id]: null });
  const ws = await mutate(workspaceId, (tracker) => {
    const current = tracker.apps.find((a) => a.id === app.id);
    if (!current || current.login?.source !== "master") return tracker;
    const { login: _l, ...rest } = current;
    return replaceApp(tracker, { ...rest, updatedAt: Date.now() });
  });
  await syncAutocheckIndex(workspaceId, ws.tracker);
  return viewApp(ws.tracker.apps.find((a) => a.id === app.id)!, todayIso(), studentScores(ws));
}

/** "Use for all portals without a login": catalog schools only, since their hosts are known. */
export async function applyMasterToAll(workspaceId: string): Promise<{ applied: number }> {
  const master = await readMaster(workspaceId);
  if (!master) throw new TrackerError("Save a master login first.");
  const { tracker } = await getWorkspace(workspaceId);
  const own = await readLogins(workspaceId);
  const changes: Record<string, { host: string }> = {};
  for (const a of tracker.apps) {
    const host = loginHost(a);
    if (!a.collegeId || !masterAllowed(a) || !host || own[a.id] || a.login?.hasPassword) continue;
    changes[a.id] = { host };
  }
  const ids = new Set(Object.keys(changes));
  if (!ids.size) return { applied: 0 };
  await setMasterFor(workspaceId, changes);
  const ws = await mutate(workspaceId, (t) => ({
    ...t,
    // Re-checked inside the write: a school that got its own login meanwhile keeps it.
    apps: t.apps.map((a) => (ids.has(a.id) && !a.login?.hasPassword ? { ...a, login: { username: master.username, hasPassword: true, source: "master" as const }, updatedAt: Date.now() } : a)),
  }));
  await syncAutocheckIndex(workspaceId, ws.tracker);
  return { applied: ids.size };
}

// ── Check schedule ──────────────────────────────────────────────────────────

/**
 * Sets when automatic checks run. Marks the current slot done, so saving a schedule doesn't set off a check
 * straight away; the next one runs at the next slot.
 */
export async function setSchedule(workspaceId: string, input: { everyHours: number; startHour: number; timeZone?: string }) {
  if (!isEveryHours(input.everyHours)) throw new TrackerError("Choose every 8, 12 or 24 hours.");
  if (!Number.isInteger(input.startHour) || input.startHour < 0 || input.startHour > 23) throw new TrackerError("Choose a start hour from 0 to 23.");
  if (input.timeZone !== undefined && !isTimeZone(input.timeZone)) throw new TrackerError("Unknown time zone.");
  const ws = await mutate(workspaceId, (tracker) => {
    const schedule: CheckSchedule = {
      everyHours: input.everyHours as CheckSchedule["everyHours"],
      startHour: input.startHour,
      timeZone: canonicalZone(input.timeZone) ?? normalizeSchedule(tracker.schedule).timeZone,
    };
    return { ...tracker, schedule, lastSlotAt: latestSlot(schedule, Date.now()) };
  });
  await syncAutocheckIndex(workspaceId, ws.tracker);
  return viewTracker(ws.tracker, todayIso(), ws.revision, studentScores(ws), ws.colleges, ws.onboarding.listPrefs?.needAid);
}

export async function setEmails(workspaceId: string, on: boolean) {
  const ws = await mutate(workspaceId, (tracker) => ({ ...tracker, emails: on }));
  return viewTracker(ws.tracker, todayIso(), ws.revision, studentScores(ws), ws.colleges, ws.onboarding.listPrefs?.needAid);
}

export async function setAutocheck(workspaceId: string, on: boolean) {
  const ws = await mutate(workspaceId, (tracker) => ({ ...tracker, autocheck: on }));
  await syncAutocheckIndex(workspaceId, ws.tracker);
  return viewTracker(ws.tracker, todayIso(), ws.revision, studentScores(ws), ws.colleges, ws.onboarding.listPrefs?.needAid);
}

/**
 * Brings a College Apps account in: new schools are added, schools already here only gain a missing login.
 * Logins are saved before the applications that point at them, so a failure part way can be retried.
 */
export async function importFromCollegeApps(workspaceId: string, email: string, password: string) {
  if (!email.includes("@") || !password) throw new TrackerError("Enter your College Apps email and password.");
  const incoming = toTracked(await fetchCollegeAppsVault(email, password));
  const before = await getWorkspace(workspaceId);
  const saved = await readLogins(workspaceId);
  const same = (a: TrackedApp, b: TrackedApp) => (!!b.collegeId && a.collegeId === b.collegeId) || a.name.toLowerCase() === b.name.toLowerCase();
  const logins: Record<string, PortalLogin> = {};
  for (const { app, login } of incoming) {
    if (!login) continue;
    const existing = before.tracker.apps.find((a) => same(a, app));
    if (!existing) logins[app.id] = login;
    // A school using the master login keeps it.
    else if (!saved[existing.id] && existing.login?.source !== "master") logins[existing.id] = login;
  }
  if (Object.keys(logins).length) await saveLogins(workspaceId, logins);
  let added = 0;
  let linked = 0;
  const ws = await mutate(workspaceId, (tracker) => {
    let next = tracker;
    added = 0;
    linked = 0;
    for (const { app } of incoming) {
      const existing = next.apps.find((a) => same(a, app));
      if (existing && isUntouchedApp(existing)) {
        // An empty application (often the one the list sync made for a list school) takes the imported one's
        // details, keeping its id and list link.
        const { login: _meta, ...rest } = app;
        const login = logins[existing.id] ?? saved[existing.id];
        next = replaceApp(next, {
          ...rest, id: existing.id, createdAt: existing.createdAt, updatedAt: Date.now(),
          ...(existing.slug ? { slug: existing.slug } : {}),
          ...(login ? { login: { username: login.username, hasPassword: true } } : {}),
        });
        linked++;
        continue;
      }
      if (existing) {
        // A login saved by an earlier attempt that failed before this write counts too.
        const login = logins[existing.id] ?? saved[existing.id];
        if (login && !existing.login?.hasPassword) {
          next = replaceApp(next, { ...existing, login: { username: login.username, hasPassword: true }, updatedAt: Date.now() });
          linked++;
        }
        continue;
      }
      const { login: _meta, ...rest } = app;
      const login = logins[app.id];
      next = { ...next, apps: [...next.apps, login ? { ...rest, login: { username: login.username, hasPassword: true } } : rest] };
      added++;
    }
    return next;
  });
  await syncAutocheckIndex(workspaceId, ws.tracker);
  // Remembered so the one-time "College Apps is now Forge" email skips this account.
  await writeDoc(`collegeapps-moved/${emailHash(email)}.json`, { at: Date.now() });
  return { added, linked, total: incoming.length, tracker: viewTracker(ws.tracker, todayIso(), ws.revision, studentScores(ws), ws.colleges, ws.onboarding.listPrefs?.needAid) };
}

/** Upcoming deadlines and decision dates, soonest first, plus the student's own dates from the timeline. */
export function upcoming(ws: Workspace, today = todayIso(), days = 120) {
  const until = new Date(`${today}T12:00:00Z`);
  until.setUTCDate(until.getUTCDate() + days);
  const end = until.toISOString().slice(0, 10);
  const rows: { date: string; kind: string; school?: string; label: string; estimated: boolean }[] = [];
  for (const app of ws.tracker.apps) {
    const stage = statusInfo(app.status).stage;
    if (app.deadline && stage === "working") rows.push({ date: app.deadline, kind: "Deadline", school: app.name, label: `${app.name} application due`, estimated: false });
    if (stage === "working" || stage === "waiting") {
      const d = decisionDateOf(app, today);
      if (d) rows.push({ date: d.date, kind: "Decision", school: app.name, label: `${app.name} decision${d.estimated ? " (estimated from last year)" : ""}`, estimated: d.estimated });
    }
  }
  for (const { school, event } of upcomingInterviews(ws.tracker, today)) {
    rows.push({ date: event.date, kind: "Interview", school, label: `${school} interview${event.time ? ` at ${event.time}` : ""}`, estimated: false });
  }
  for (const d of ws.criticalDates) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) rows.push({ date: d.date, kind: "Date", label: d.label, estimated: false });
  }
  return rows.filter((r) => r.date >= today && r.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Follow-ups and flags ────────────────────────────────────────────────────

async function changeApp(workspaceId: string, ref: string, change: (app: TrackedApp) => TrackedApp): Promise<AppView> {
  let id = "";
  const ws = await mutate(workspaceId, (tracker) => {
    const app = mustFind(tracker, ref);
    id = app.id;
    return replaceApp(tracker, change(app));
  });
  return viewApp(ws.tracker.apps.find((a) => a.id === id)!, todayIso(), studentScores(ws));
}

export const addFollowUpTo = (workspaceId: string, ref: string, text: string, due = "") =>
  changeApp(workspaceId, ref, (app) => addFollowUp(app, text, due));

export const updateFollowUp = (workspaceId: string, ref: string, id: string, change: { done?: boolean; remove?: boolean }) =>
  changeApp(workspaceId, ref, (app) => setFollowUp(app, id, change));

export async function flag(workspaceId: string, text: string, scope = "") {
  const ws = await mutate(workspaceId, (tracker) => addFlag(tracker, text, scope));
  return viewTracker(ws.tracker, todayIso(), ws.revision, studentScores(ws), ws.colleges, ws.onboarding.listPrefs?.needAid);
}

export async function unflag(workspaceId: string, id: string) {
  const ws = await mutate(workspaceId, (tracker) => resolveFlag(tracker, id));
  return viewTracker(ws.tracker, todayIso(), ws.revision, studentScores(ws), ws.colleges, ws.onboarding.listPrefs?.needAid);
}
