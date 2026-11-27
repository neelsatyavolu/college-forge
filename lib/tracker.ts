import { randomUUID } from "node:crypto";
import { COLLEGES, collegeById, expectedDecision, logoUrl, type College } from "./catalog";
import { applyTestingEdit, type TestingChoice, type TestingEdit } from "./testing-plan";
import { checkAidOffer, type AidOffer } from "./aid-validate";
import type { InterestEvent } from "./interest-log";
import { normalizeSchedule, type CheckSchedule } from "./check-schedule";

/**
 * The applications tracker, ported from College Apps. Each school the student applies to, where it stands,
 * and what the last portal check found. Logins are not here: they live encrypted in lib/portal-logins.ts.
 */

export const STATUSES = [
  { id: "planning", label: "Not started", stage: "working" },
  { id: "in_progress", label: "Writing", stage: "working" },
  { id: "final_checks", label: "Final checks", stage: "working" },
  { id: "submitted", label: "Submitted", stage: "waiting" },
  { id: "submitted_npy", label: "Submitted - NPY", stage: "waiting" },
  { id: "complete", label: "Under review", stage: "waiting" },
  { id: "deferred", label: "Deferred", stage: "waiting" },
  { id: "waitlisted", label: "Waitlisted", stage: "waiting" },
  { id: "admitted", label: "Admitted", stage: "admitted" },
  { id: "committed", label: "Committed", stage: "admitted" },
  { id: "denied", label: "Denied", stage: "denied" },
  { id: "withdrawn", label: "Withdrawn", stage: "closed" },
] as const;

export type StatusId = (typeof STATUSES)[number]["id"];
export type Stage = (typeof STATUSES)[number]["stage"];
export const STATUS_IDS = STATUSES.map((s) => s.id) as [StatusId, ...StatusId[]];

export const ROUNDS = ["ED", "ED2", "EA", "REA", "RD", "Rolling"] as const;
export type RoundId = (typeof ROUNDS)[number] | "";

export interface PortalItem {
  item: string;
  status: string;
  date: string;
  done: boolean;
  optional: boolean;
}

/** What the last portal check found. */
export interface PortalResult {
  checkedAt: number;
  ok: boolean;
  error: string;
  /** Why a failed check failed, as the portal engine reports it ("mfa", "signin", ...). */
  code?: string;
  statusText: string;
  checklist: PortalItem[];
  /** Words or link text saying a decision or update was posted; empty if none. */
  update: string;
  decisionDate?: string;
  round?: string;
  /** What the decision letter behind a posted update says ("Admitted", "Not admitted", ...). Shown only after a reveal. */
  outcome?: string;
}

export interface TrackedApp {
  id: string;
  /** Catalog id, or null for a school added by name or link. */
  collegeId: string | null;
  /** The Forge shortlist slug this application belongs to, when there is one. */
  slug?: string;
  /** The student took the school off the college list but kept this application (lib/list-sync.ts). */
  offList?: true;
  name: string;
  portalName: string;
  portalUrl: string;
  platform: string;
  status: StatusId;
  round: RoundId;
  /** yyyy-mm-dd or "" */
  deadline: string;
  decisionDate: string;
  notes: string;
  /** A short note about the decision ("Honors college too"), shown with it on the Progress tab and progress links. */
  decisionNote?: string;
  lastChecked: number | null;
  portal?: PortalResult;
  /** Which posted decision the student revealed on the Decisions tab. */
  decisionSeen?: string;
  /** yyyy-mm-dd the application went in; set automatically the first time it moves past "working". */
  submittedAt?: string;
  /** The student isn't applying for aid here, so aid forms (FAFSA, CSS Profile, tax returns) don't count as missing. */
  ignoreAid?: boolean;
  /** Small to-dos for this school ("Counselor uploads the SUNY form by Nov 1"). */
  followUps?: FollowUp[];
  /** Visits, info sessions, interviews and admissions-officer contact (lib/interest-log.ts). */
  interest?: InterestEvent[];
  /** The latest check that failed after an earlier one worked; the earlier result stays in `portal`. */
  lastFailure?: { at: number; error: string };
  /**
   * Mirrors whether an encrypted login is saved (the login itself is never in the workspace). `source` is
   * "master" when this school uses the student's master login rather than one of its own; missing means its own.
   */
  login?: { username: string; hasPassword: boolean; source?: "own" | "master" };
  /** A forwarded set-up email left a PIN, link or password for the student to finish with (sealed in lib/portal-setup.ts). */
  setupWaiting?: boolean;
  /** Whether to send SAT/ACT scores here, how, and when the official report went out (lib/testing-plan.ts). */
  testing?: TestingChoice;
  /** The school's financial aid offer as the student entered it (lib/aid-validate.ts AidOffer). Private to the student. */
  aidOffer?: AidOffer;
  createdAt: number;
  updatedAt: number;
}

export interface FollowUp {
  id: string;
  text: string;
  /** yyyy-mm-dd or "" */
  due: string;
  done: boolean;
  createdAt: number;
}

/** Something that needs attention across applications ("Ms. Williamson's evaluation shows Not Started"). */
export interface Flag {
  id: string;
  text: string;
  /** Which applications it affects, in words ("All Common App schools") or a school's name. */
  scope: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface Tracker {
  apps: TrackedApp[];
  /** Automatic portal checks, on `schedule`. */
  autocheck: boolean;
  /** Email the student when an automatic check finds something new. */
  emails: boolean;
  flags: Flag[];
  /** When automatic checks run (lib/check-schedule.ts); missing means the default, every 12 hours from 7:00 Pacific. */
  schedule?: CheckSchedule;
  /** The start of the last schedule slot an automatic sweep claimed. Manual checks never touch it. */
  lastSlotAt?: number;
}

export const emptyTracker = (): Tracker => ({ apps: [], autocheck: true, emails: true, flags: [] });

export const statusInfo = (id: string) => STATUSES.find((s) => s.id === id) ?? STATUSES[0];
export const isStatus = (v: unknown): v is StatusId => typeof v === "string" && STATUS_IDS.includes(v as StatusId);
export const isRound = (v: unknown): v is RoundId => v === "" || (typeof v === "string" && (ROUNDS as readonly string[]).includes(v));
const isDate = (v: unknown): v is string => v === "" || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));

// ── Decisions are only shown once the student reveals them ──────────────────

export const DECISION_RECEIVED = "Decision received";
const OUTCOME_WORDS =
  /\b(admit|admitted|admission decision|accept|accepted|acceptance|congratulations|enroll|enrollment|deposit|denied|deny|rejected|waitlist|wait list|waitlisted|defer|deferred|deferral|decided|decision (released|available|posted))\b/i;
/** A stated portal status that is itself a decision (College Apps worker/src/portal/parse.ts). */
export const DECISION_STATUS =
  /^(admitted|not admitted|denied|deny|wait ?list(ed)?|deferred|decided|decision (released|available|made)|complete - decision made|clear admit|(provisional|conditional)(ly)? admit(ted)?|admit\/deny|not csu eligible|offered (mid-year )?admission|appointment offered)\b/i;
export const revealsDecision = (text: string): boolean => OUTCOME_WORDS.test(text) || DECISION_STATUS.test(text.trim());

/** Identifies the decision the portal shows now; empty when it shows none. */
export function portalDecisionKey(app: TrackedApp): string {
  const p = app.portal;
  if (!p?.ok || !(p.update || revealsDecision(p.statusText))) return "";
  return `${p.statusText}|${p.update}`;
}

const NAMES_OUTCOME = /\b(admit|admitted|denied|deny|wait ?list(ed)?|defer(red)?|not csu eligible|offered|appointment)\b/i;
const NO_OUTCOME = /^(decided|decision\b|complete - decision made|admit\/deny)/i;

export interface DecisionView {
  /** "none": nothing yet. "hidden": the portal posted one the student hasn't revealed. */
  state: "none" | "hidden" | "revealed" | "recorded";
  /** The portal's words for the outcome, when it names one and it was revealed. */
  portalText: string;
}

export function decisionOf(app: TrackedApp): DecisionView {
  const key = portalDecisionKey(app);
  if (key) {
    const status = app.portal!.statusText;
    const portalText = NAMES_OUTCOME.test(status) && !NO_OUTCOME.test(status) ? status : app.portal!.outcome || "";
    return app.decisionSeen === key ? { state: "revealed", portalText } : { state: "hidden", portalText: "" };
  }
  const stage = statusInfo(app.status).stage;
  const recorded = stage === "admitted" || stage === "denied" || app.status === "deferred" || app.status === "waitlisted";
  return { state: recorded ? "recorded" : "none", portalText: "" };
}

/** A portal result safe to show before a reveal: no decision words in it. */
export function shownPortal(app: TrackedApp): PortalResult | undefined {
  const p = app.portal;
  if (!p) return undefined;
  if (portalDecisionKey(app) && app.decisionSeen !== portalDecisionKey(app)) {
    const { outcome: _hidden, ...rest } = p;
    return { ...rest, statusText: "", update: DECISION_RECEIVED, checklist: [] };
  }
  return { ...p, checklist: p.checklist.filter((c) => !revealsDecision(c.item) || app.decisionSeen === portalDecisionKey(app)) };
}

const AID_WORDS = /\b(fafsa|css profile|idoc|financial aid|student aid|tax returns?|w-?2s?|1040|non-?custodial|verification worksheet)\b/i;
export const isAidItem = (text: string): boolean => AID_WORDS.test(text);

/** Checklist items that count for this school: aid forms drop out when the student said to ignore them. */
export const countedItems = (app: TrackedApp, checklist: PortalItem[]): PortalItem[] =>
  app.ignoreAid ? checklist.filter((c) => !isAidItem(c.item)) : checklist;

const MID_YEAR = /\bmid[\s-]?year\b/i;
/** Mid-year grades can't exist before first-semester grades close, so they aren't missing until Jan 5 (Aug–Jan 4). */
const midYearNotDue = (today: string): boolean => {
  const md = today.slice(5);
  return md >= "08-01" || md < "01-05";
};

export function missingItems(app: TrackedApp, today = todayIso()): string[] {
  const p = app.portal;
  if (!p?.ok) return [];
  const early = midYearNotDue(today);
  return countedItems(app, p.checklist)
    .filter((c) => !c.done && !c.optional && !revealsDecision(c.item) && !(early && MID_YEAR.test(c.item)))
    .map((c) => c.item);
}

// ── Dates ─────────────────────────────────────────────────────────────────

export const effectiveRound = (app: TrackedApp): string => app.round || app.portal?.round || "";

export interface NextDate {
  date: string;
  kind: "Deadline" | "Decision";
  /** From last cycle's published timing, not the portal or the student. */
  estimated: boolean;
}

export function decisionDateOf(app: TrackedApp, today: string): NextDate | null {
  const exact = app.decisionDate || app.portal?.decisionDate || "";
  if (exact) return { date: exact, kind: "Decision", estimated: false };
  const estimate = expectedDecision(app.collegeId ? collegeById(app.collegeId) : undefined, effectiveRound(app), new Date(`${today}T12:00:00`));
  return estimate ? { date: estimate, kind: "Decision", estimated: true } : null;
}

/** The next date worth knowing: the deadline while working on it, then the decision date. */
export function nextDate(app: TrackedApp, today: string): NextDate | null {
  const stage = statusInfo(app.status).stage;
  const options: NextDate[] = [];
  if (app.deadline && stage === "working") options.push({ date: app.deadline, kind: "Deadline", estimated: false });
  if (stage === "working" || stage === "waiting") {
    const d = decisionDateOf(app, today);
    if (d) options.push(d);
  }
  return options.filter((o) => o.date >= today).sort((x, y) => x.date.localeCompare(y.date))[0] ?? null;
}

export function todayIso(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

// ── Applying a portal check ───────────────────────────────────────────────

const ADJUSTABLE: StatusId[] = ["planning", "in_progress", "final_checks", "submitted", "submitted_npy", "complete"];

/** Statuses a check may set: never a decision, deferral or waitlist, which are the student's to record. */
export function suggestedStatus(app: TrackedApp, result: PortalResult): StatusId {
  if (!result.ok || !ADJUSTABLE.includes(app.status)) return app.status;
  const required = countedItems(app, result.checklist).filter((c) => !c.optional);
  const allIn = required.length > 0 && required.every((c) => c.done);
  if (required.some((c) => !c.done)) return "submitted";
  if (/awaiting materials|incomplete/i.test(result.statusText)) return "submitted";
  if (allIn || /complete|review|decided|decision/i.test(result.statusText)) return "complete";
  if (required.length > 0) return "submitted";
  return app.status;
}

function followsPortal(mine: string, before: string | undefined, now: string | undefined): boolean {
  if (!mine) return false;
  return mine === before || (!!now && now !== mine);
}

/**
 * Applies a check. A failed check never replaces a good result (an outage or a Duo prompt must not hide a
 * posted decision): it's kept as `lastFailure` beside the last good snapshot. A result older than the saved
 * one is ignored, so a slow check can't overwrite a newer one.
 */
export function withResult(app: TrackedApp, result: PortalResult): TrackedApp {
  const prev = app.portal;
  const lastAttempt = Math.max(prev?.checkedAt ?? 0, app.lastFailure?.at ?? 0);
  if (!result.ok) {
    if (result.checkedAt < lastAttempt) return app;
    if (prev?.ok) return { ...app, lastFailure: { at: result.checkedAt, error: result.error }, updatedAt: Math.max(result.checkedAt, app.updatedAt + 1) };
    return { ...app, portal: result, updatedAt: Math.max(result.checkedAt, app.updatedAt + 1) };
  }
  if (prev && result.checkedAt < prev.checkedAt) return app;
  // A good result older than a later failure still replaces the older snapshot, but the failure stays news.
  const keepFailure = app.lastFailure && app.lastFailure.at > result.checkedAt;
  const { lastFailure: _f, ...base } = app;
  const rest = keepFailure ? { ...base, lastFailure: app.lastFailure } : base;
  return {
    ...rest,
    portal: result,
    status: suggestedStatus(app, result),
    lastChecked: result.checkedAt,
    decisionDate: followsPortal(app.decisionDate, prev?.decisionDate, result.decisionDate) ? "" : app.decisionDate,
    round: (followsPortal(app.round, prev?.round, result.round) ? "" : app.round) as RoundId,
    updatedAt: Math.max(result.checkedAt, app.updatedAt + 1),
  };
}

// ── Catalog ───────────────────────────────────────────────────────────────

const norm = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(/\b(the|at)\b/g, " ").replace(/\s+/g, " ").trim();
const BY_NAME = new Map<string, College>();
/** Full names the catalog writes short ("UC Davis" is also "University of California, Davis"). */
const LONG_NAMES: Record<string, string[]> = {
  ucla: ["University of California, Los Angeles"],
  psu: ["Pennsylvania State University", "Penn State University", "Penn State University Park"],
  wustl: ["WashU in St. Louis", "WashU St. Louis"],
  iu: ["Indiana University"],
  unc: ["University of North Carolina at Chapel Hill", "University of North Carolina"],
  umd: ["University of Maryland College Park"],
  umich: ["University of Michigan Ann Arbor"],
  rutgers: ["Rutgers University New Brunswick", "Rutgers New Brunswick"],
};
for (const c of COLLEGES) {
  BY_NAME.set(norm(c.name), c);
  for (const a of c.aliases) if (!BY_NAME.has(norm(a))) BY_NAME.set(norm(a), c);
  const long = [...(LONG_NAMES[c.id] ?? []), ...(/^UC /.test(c.name) ? [`University of California ${c.name.slice(3)}`] : [])];
  for (const l of long) if (!BY_NAME.has(norm(l))) BY_NAME.set(norm(l), c);
}

/** A catalog school for a name ("Univ. of Michigan", "UMich") or an id, if one matches exactly. */
export function matchCatalog(nameOrId: string): College | undefined {
  const exact = collegeById(nameOrId.trim().toLowerCase()) ?? BY_NAME.get(norm(nameOrId));
  if (exact) return exact;
  // "University of Michigan-Ann Arbor", "University of Maryland, College Park", "SUNY Stony Brook": try the name without the campus.
  const base = nameOrId.split(/\s*[-–—,]\s*/)[0]!;
  const noSuny = nameOrId.replace(/^\s*SUNY\s+(at\s+)?/i, "");
  return (base !== nameOrId ? BY_NAME.get(norm(base)) : undefined) ?? (noSuny !== nameOrId ? BY_NAME.get(norm(noSuny)) ?? BY_NAME.get(norm(`${noSuny} University`)) : undefined);
}

/** A catalog school whose id, name, alias or long name matches exactly (no campus-stripping fallback). */
export function matchCatalogExact(nameOrId: string): College | undefined {
  return collegeById(nameOrId.trim().toLowerCase()) ?? BY_NAME.get(norm(nameOrId));
}

/** Compact catalog for the hub's school picker. */
export function catalogForClient() {
  return COLLEGES.map((c) => ({
    id: c.id,
    name: c.name,
    state: c.state,
    monogram: c.monogram,
    colors: c.colors,
    portalName: c.portalName,
    loginUrl: c.loginUrl,
    howToLogIn: c.howToLogIn,
    logo: logoUrl(c.id) ?? null,
  }));
}

export function newApp(input: { name: string; collegeId?: string | null; slug?: string; portalUrl?: string }, now = Date.now()): TrackedApp {
  const college = input.collegeId ? collegeById(input.collegeId) : matchCatalog(input.name);
  return {
    id: randomUUID(),
    collegeId: college?.id ?? null,
    ...(input.slug ? { slug: input.slug } : {}),
    name: college?.name ?? input.name.trim().slice(0, 120),
    portalName: college?.portalName ?? "Applicant portal",
    portalUrl: input.portalUrl || college?.loginUrl || "",
    platform: college?.platform ?? "other",
    status: "planning",
    round: "",
    deadline: "",
    decisionDate: "",
    notes: "",
    lastChecked: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Finds an application by id, catalog id, Forge slug, or (case-insensitive) name or a unique part of it. */
export function findApp(tracker: Tracker, ref: string): TrackedApp | undefined {
  const r = ref.trim().toLowerCase();
  if (!r) return undefined;
  const exact = tracker.apps.find((a) => a.id === ref || a.collegeId === r || a.slug === r || a.name.toLowerCase() === r);
  if (exact) return exact;
  const catalog = matchCatalog(ref);
  if (catalog) {
    const byCatalog = tracker.apps.find((a) => a.collegeId === catalog.id);
    if (byCatalog) return byCatalog;
  }
  const partial = tracker.apps.filter((a) => a.name.toLowerCase().includes(r));
  return partial.length === 1 ? partial[0] : undefined;
}

// ── Edits (shared by the hub, the AI copilot and MCP) ────────────────────────

export interface AppEdit {
  status?: StatusId;
  submittedAt?: string;
  round?: RoundId;
  deadline?: string;
  decisionDate?: string;
  notes?: string;
  decisionNote?: string;
  portalUrl?: string;
  name?: string;
  ignoreAid?: boolean;
  testing?: TestingEdit;
  /** Dollar amounts per year (numbers or "$12,000"); null removes the offer. */
  aidOffer?: { costOfAttendance?: unknown; grants?: unknown; loans?: unknown; workStudy?: unknown; notes?: unknown } | null;
}

/** Validates and applies an edit; throws with a user-facing message on bad input. */
export function editApp(app: TrackedApp, edit: AppEdit, now = Date.now()): TrackedApp {
  if (edit.status !== undefined && !isStatus(edit.status)) throw new Error(`Unknown status "${edit.status}".`);
  if (edit.round !== undefined && !isRound(edit.round)) throw new Error(`Unknown round "${edit.round}".`);
  if (edit.deadline !== undefined && !isDate(edit.deadline)) throw new Error("Deadline must be yyyy-mm-dd or empty.");
  if (edit.decisionDate !== undefined && !isDate(edit.decisionDate)) throw new Error("Decision date must be yyyy-mm-dd or empty.");
  if (edit.submittedAt !== undefined && !isDate(edit.submittedAt)) throw new Error("Submitted date must be yyyy-mm-dd or empty.");
  if (edit.portalUrl !== undefined && edit.portalUrl !== "" && !/^https:\/\/[^\s/]+/.test(edit.portalUrl)) {
    throw new Error("Portal links must start with https://.");
  }
  if (edit.ignoreAid !== undefined && typeof edit.ignoreAid !== "boolean") throw new Error("Ignore financial aid must be true or false.");
  const clean: Partial<TrackedApp> = {};
  if (edit.status !== undefined) clean.status = edit.status;
  if (edit.submittedAt !== undefined) clean.submittedAt = edit.submittedAt;
  // The first move past "working" records when it went in, unless a date was given.
  const nextStatus = edit.status ?? app.status;
  if (!app.submittedAt && edit.submittedAt === undefined && statusInfo(app.status).stage === "working" && statusInfo(nextStatus).stage !== "working") {
    clean.submittedAt = todayIso(new Date(now));
  }
  if (edit.round !== undefined) clean.round = edit.round;
  if (edit.deadline !== undefined) clean.deadline = edit.deadline;
  if (edit.decisionDate !== undefined) clean.decisionDate = edit.decisionDate;
  if (edit.notes !== undefined) clean.notes = String(edit.notes).slice(0, 4000);
  if (edit.decisionNote !== undefined) clean.decisionNote = String(edit.decisionNote).trim().slice(0, 1000);
  if (edit.portalUrl !== undefined) clean.portalUrl = edit.portalUrl.slice(0, 500);
  if (edit.ignoreAid !== undefined) clean.ignoreAid = edit.ignoreAid;
  if (edit.name !== undefined && edit.name.trim()) clean.name = edit.name.trim().slice(0, 120);
  if (edit.testing !== undefined) clean.testing = applyTestingEdit(app.testing, edit.testing);
  if (edit.aidOffer !== undefined) {
    const offer = checkAidOffer(edit.aidOffer, now);
    if (!offer.ok) throw new Error(offer.error);
    if (offer.value === null) {
      const { aidOffer: _gone, ...rest } = app;
      return { ...rest, ...clean, updatedAt: now };
    }
    clean.aidOffer = offer.value;
  }
  return { ...app, ...clean, updatedAt: now };
}

export function revealDecision(app: TrackedApp): TrackedApp {
  const key = portalDecisionKey(app);
  return key ? { ...app, decisionSeen: key, updatedAt: Date.now() } : app;
}

export const replaceApp = (tracker: Tracker, app: TrackedApp): Tracker => ({
  ...tracker,
  apps: tracker.apps.map((a) => (a.id === app.id ? app : a)),
});

// ── Migration from Forge's old per-school status ─────────────────────────────

const OLD_STATUS: Record<string, StatusId | null> = {
  researching: null,
  preparing: "in_progress",
  submitted: "submitted",
  accepted: "admitted",
  rejected: "denied",
  waitlisted: "waitlisted",
  deferred: "deferred",
  withdrawn: "withdrawn",
};

/** Turns the old shortlist status (anything past "researching") into tracker entries, once. */
export function migrateOldStatuses(
  tracker: Tracker,
  colleges: { slug: string; name: string; deadline?: string }[],
  applications: Record<string, { status: string; notes?: string }>,
  now = Date.now(),
): Tracker {
  const added: TrackedApp[] = [];
  for (const c of colleges) {
    const status = OLD_STATUS[applications[c.slug]?.status ?? "researching"];
    if (!status || tracker.apps.some((a) => a.slug === c.slug)) continue;
    const base = newApp({ name: c.name, slug: c.slug }, now);
    if (tracker.apps.some((a) => base.collegeId && a.collegeId === base.collegeId)) continue;
    added.push({ ...base, status, notes: applications[c.slug]?.notes ?? "" });
  }
  return added.length ? { ...tracker, apps: [...tracker.apps, ...added] } : tracker;
}

/** A school saved without a catalog match (an older name form) picks up its catalog entry, logo and portal. */
function relink(app: TrackedApp): TrackedApp {
  if (app.collegeId) return app;
  const c = matchCatalog(app.name);
  if (!c) return app;
  return {
    ...app,
    collegeId: c.id,
    portalName: app.portalName === "Applicant portal" ? c.portalName : app.portalName,
    portalUrl: app.portalUrl || c.loginUrl,
    platform: app.platform === "other" ? c.platform : app.platform,
  };
}

/** Normalizes whatever was stored (older or partial data) into a valid tracker. */
export function normalizeTracker(raw: unknown): Tracker {
  if (!raw || typeof raw !== "object") return emptyTracker();
  const t = raw as Partial<Tracker>;
  const apps = Array.isArray(t.apps)
    ? t.apps.filter((a): a is TrackedApp => !!a && typeof a.id === "string" && typeof a.name === "string" && isStatus(a.status)).map(relink)
    : [];
  const flags = Array.isArray(t.flags) ? t.flags.filter((f): f is Flag => !!f && typeof f.id === "string" && typeof f.text === "string") : [];
  return {
    apps,
    autocheck: t.autocheck !== false,
    emails: t.emails !== false,
    flags,
    ...(t.schedule ? { schedule: normalizeSchedule(t.schedule) } : {}),
    ...(typeof t.lastSlotAt === "number" && Number.isFinite(t.lastSlotAt) ? { lastSlotAt: t.lastSlotAt } : {}),
  };
}

// ── Follow-ups and flags ──────────────────────────────────────────────────

const cleanText = (text: string, max: number) => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  if (!t) throw new Error("Write what needs to happen.");
  return t;
};

export function addFollowUp(app: TrackedApp, text: string, due = "", now = Date.now()): TrackedApp {
  if (!isDate(due)) throw new Error("Due date must be yyyy-mm-dd or empty.");
  const item: FollowUp = { id: randomUUID().slice(0, 8), text: cleanText(text, 300), due, done: false, createdAt: now };
  // Pressing "Add to-dos" twice, or a retried request, must not list the same open to-do twice.
  if ((app.followUps ?? []).some((f) => !f.done && f.text.toLowerCase() === item.text.toLowerCase())) return app;
  // Keep every open follow-up; finished ones make room (the newest 10 are kept for history).
  const open = (app.followUps ?? []).filter((f) => !f.done);
  if (open.length >= 30) throw new Error("Already 30 open follow-ups for this school. Finish some first.");
  const done = (app.followUps ?? []).filter((f) => f.done).slice(-10);
  return { ...app, followUps: [...done, ...open, item], updatedAt: now };
}

export function setFollowUp(app: TrackedApp, id: string, change: { done?: boolean; remove?: boolean }, now = Date.now()): TrackedApp {
  const list = app.followUps ?? [];
  if (!list.some((f) => f.id === id)) throw new Error("No follow-up with that id on this application.");
  const followUps = change.remove ? list.filter((f) => f.id !== id) : list.map((f) => (f.id === id ? { ...f, done: change.done ?? f.done } : f));
  return { ...app, followUps, updatedAt: now };
}

export function addFlag(tracker: Tracker, text: string, scope = "", now = Date.now()): Tracker {
  const flag: Flag = { id: randomUUID().slice(0, 8), text: cleanText(text, 500), scope: String(scope ?? "").trim().slice(0, 80), createdAt: now };
  return { ...tracker, flags: [...tracker.flags.filter((f) => !f.resolvedAt || now - f.resolvedAt < 30 * 864e5), flag] };
}

export function resolveFlag(tracker: Tracker, id: string, now = Date.now()): Tracker {
  if (!tracker.flags.some((f) => f.id === id)) throw new Error("No flag with that id.");
  return { ...tracker, flags: tracker.flags.map((f) => (f.id === id ? { ...f, resolvedAt: now } : f)) };
}
