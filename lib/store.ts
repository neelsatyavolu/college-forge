import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { COMMON_APP_PERSONAL_PROMPTS } from "./common-app-prompts";
import { refreshScrapedSupplements, syncEssaySupplements, syncSuppStatus } from "./essay-supplements";
import { keepValidCommonAppPrompt, visibleEssays } from "./essay-tools";
import { linkListAndApplications, syncListAndApplications } from "./list-sync";
import { cleanupApps, removedAppIds } from "./app-cleanup";
import { listDocs } from "./doc-store";
import { emptyTracker, migrateOldStatuses, normalizeTracker, shownPortal, type Tracker } from "./tracker";
import type { AdmissionOdds, ApplicationRead } from "./admission-odds";
import type { SchoolStats } from "./school-stats";
import type { SchoolResearch } from "./school-research";
import { sharedScholarship } from "./aid-validate";

// ── Workspace data model ──────────────────────────────────────────────────
// Mirrors the shape the hub UI renders (window.CF_DATA). Everything starts
// empty; the AI copilot (and manual editors) populate it.

export type APScore = { course: string; score: string };
export type Activity = {
  rank: number; name: string; type: string; org?: string; years?: string;
  role?: string; hpw?: string; wpy?: string; college?: boolean;
  desc?: string; bullets?: string[];
};
export type Honor = { title: string; level: string; year?: string; top?: boolean };
export type Plan = { plan: string; rate: string };
export type Deadline = { plan: string; date: string };
export type Tag = { label: string; tone: string };
export type College = {
  slug: string; name: string; short: string; location?: string; setting?: string;
  rank?: number; admit?: string; satRange?: string; gpa?: string; photo?: string | null;
  tier?: "reach" | "target" | "safety"; verdict?: { tone: string; label: string };
  priority?: boolean; major?: string; deadline?: string; supp?: string; tags?: Tag[];
  size?: string; act?: string; netPrice?: string; grad6?: string; earnings?: string;
  plans?: Plan[]; deadlines?: Deadline[]; fee?: string; transfer?: string;
  scorecardId?: number;
  coa?: string;
  tuitionIn?: string;
  tuitionOut?: string;
  grad4?: string;
  retention?: string;
  ownership?: string;
  testPolicy?: string;
  pellRate?: string;
  url?: string;
  priceCalcUrl?: string;
  /** Who put the row on the list. "seed": the automatic list builder, which may replace it on a rebalance. Missing counts as the student's. */
  origin?: "seed" | "user" | "agent";
  /** What a year would likely cost this student, from the draft list (income bracket or full cost). */
  netPriceForYou?: string;
  /** Whether the application needs supplemental essays. */
  supplementsNeeded?: "yes" | "no";
  /** Sourced facts from the onboarding research step (lib/school-research.ts shape). Missing: not researched. */
  research?: SchoolResearch & { attempts?: number; needsReview?: boolean };
};
export type Essay = {
  id: string; group?: string; label: string; prompt: string;
  limit: number; unit: string; starter?: string;
  /** false: optional, or only for some applicants (see audience). Missing counts as required unless the label says optional. */
  required?: boolean;
  /** Prompts sharing a chooseGroup form a set where the student answers `choose` of them (UC PIQs: 4 of 8). */
  chooseGroup?: string;
  /** With options: how many options to answer in this one prompt. With chooseGroup: how many prompts of the set. */
  choose?: number;
  options?: string[];
  /** The school, program or degree inside the university the prompt is for. */
  audience?: string;
  source?: "official" | "collegevine";
  cycle?: string | null;
};
export type EssayStatus = "draft" | "final";
/** Text the copilot proposed for an essay, waiting for the student to use or dismiss it. */
export type EssaySuggestion = { text: string; createdAt: number };
export type UploadMeta = { name: string; chars: number; uploadedAt: number };

/** How aggressive the preliminary college list should be. */
export type ListAmbition = "ambitious" | "balanced" | "conservative";

export type OnboardingListPrefs = {
  ambition: ListAmbition;
  /**
   * Target number of *applications* (not campuses).
   * All UC campuses count as 1. Null/omitted → seeder default (~12).
   * Typical range 8–15.
   */
  appCount?: number | null;
  /** Campus settings the student prefers (urban, suburban, rural, college-town). */
  settings: string[];
  /** Preferred enrollment size: small | medium | large | any */
  size: string;
  /** Geographic regions of interest. */
  regions: string[];
  /** Free-text constraints (“need strong CS”, “in-state public only”, etc.). */
  notes: string;
  /** Yearly family budget bucket in $1,000s. "50plus" and "unsure" set no price cap. */
  budget?: ListBudget;
  /** The family will apply for need-based aid. */
  needAid?: boolean;
  /** Whether the student would apply Early Decision. */
  ed?: "yes" | "no" | "maybe";
  /** Set once the student chose an ambition level themselves (not the default). */
  ambitionChosen?: boolean;
  /** How many applications with supplemental essays the student will write (UC counts as one). */
  suppCount?: number;
  /** How many quick applications with no supplements the student wants. */
  noSuppCount?: number;
  /** Forge suggested the two counts because the student wasn't sure. */
  countsRecommended?: boolean;
  /** Family income bracket, the same bands as federal net-price data. */
  incomeBracket?: IncomeBracket;
  /** Citizenship for aid and admission rules: international students face different aid and odds. */
  citizenship?: "us" | "permanent" | "international" | "unsure";
  /** First in the family to go to college. */
  firstGen?: "yes" | "no" | "unsure";
};

export type IncomeBracket = "lt30" | "30-48" | "48-75" | "75-110" | "gt110" | "unsure";

export type ListBudget = "lt15" | "15-30" | "30-50" | "50plus" | "unsure";

export type InterviewSection = "basics" | "school" | "testing" | "activities" | "campus" | "money" | "early" | "deep";
export type InterviewPhase = "interview" | "list" | "research" | "strategy" | "plan" | "done";
/** One stored chat turn of the onboarding interview. `ui` is the tile/list/strategy the AI showed with it. */
export type InterviewTurn = { role: "user" | "assistant"; content: string; ui?: unknown; at: number };
export type InterviewState = {
  phase: InterviewPhase;
  section: InterviewSection;
  transcript: InterviewTurn[];
  /** Short AI-written summaries per section, so later turns need little history. */
  notes: Partial<Record<InterviewSection, string>>;
  /** Answers to the deeper questions (also copied into storyNotes.other). */
  deep: { prompt: string; answer: string }[];
  /** The student said they have no activities yet. */
  noActivities?: boolean;
  /** Merit-aid interest from the money section. */
  meritInterest?: "yes" | "no" | "unsure";
  /** The AI's ED/EA recommendation once the student confirmed it. */
  strategy?: { ed?: string; ea: string[]; reasons: string; confirmed: boolean };
  /** The last draft list the AI proposed (UiSchool[] from lib/chat-types.ts). */
  listDraft?: import("./chat-types").UiSchool[];
  /** Balance problems Forge pushed back on for the current draft; after two, the list is shown with a warning. */
  listRefusals?: number;
  /** The early-round idea shown with the draft list. */
  edIdea?: import("./chat-types").UiEdIdea;
  transferPath?: import("./chat-types").UiTransferPath;
  startedAt: number;
};

export type OnboardingState = {
  completed: boolean;
  /** The chat interview (onboarding v2). */
  interview?: InterviewState;
  completedAt?: number;
  /** Freeform story from onboarding (activities / awards / other) for the AI. */
  storyNotes?: {
    activities: string;
    awards: string;
    other: string;
  };
  listPrefs?: OnboardingListPrefs;
  /** Tiers the last list build or rebalance could not fill ("safety" is Likely in the UI). `goal` is the tier's quota. */
  listGaps?: { tier: "reach" | "target" | "safety"; missing: number; goal?: number }[];
};

export type AppStatus =
  | "researching"
  | "preparing"
  | "submitted"
  | "accepted"
  | "rejected"
  | "waitlisted"
  | "deferred"
  | "withdrawn";

export type ApplicationEntry = {
  status: AppStatus;
  submittedAt?: string;
  decisionAt?: string;
  notes?: string;
};

export type Recommendation = {
  id: string;
  name: string;
  type: "counselor" | "teacher" | "other";
  subject?: string;
  status: "not_asked" | "asked" | "in_progress" | "submitted" | "waived";
  deadline?: string;
  notes?: string;
  /** yyyy-mm-dd the student asked for the letter. */
  askedAt?: string;
  email?: string;
  /** Tracker application ids this letter goes to (lib/recommenders.ts). */
  schools?: string[];
  thankYouSent?: boolean;
  /** What the student gave the recommender about themselves (at most 4000 characters). */
  bragSheet?: string;
};

export type Scholarship = {
  id: string;
  name: string;
  amount?: string;
  deadline?: string;
  status: "researching" | "in_progress" | "submitted" | "won" | "lost" | "skipped";
  url?: string;
  notes?: string;
  /** "school": the school's own award, tied to `slug`. Missing means "outside". */
  kind?: "outside" | "school";
  /** The college on the list this award is from (lib/aid-validate.ts checks it is on the list). */
  slug?: string;
};

export type AidFormStatus = "not_started" | "in_progress" | "submitted" | "processed" | "n_a";

export type FinancialAid = {
  fafsaStatus: "not_started" | "in_progress" | "submitted" | "processed";
  cssStatus: AidFormStatus;
  /** College Board IDOC (tax documents some CSS Profile schools ask for). "n_a" until a school needs it. */
  idocStatus?: AidFormStatus;
  fafsaOpenDate?: string;
  notes?: string;
};

export type AdvisorNote = {
  id: string;
  body: string;
  author: string;
  createdAt: number;
  essayId?: string;
  /** Which kind of share link it came through, or "counselor" / "coach" for an invited counselor's or writing coach's account. Progress links only ever show notes left through progress links. */
  via?: "progress" | "full" | "counselor" | "coach";
  /** The counselor or coach link that wrote it (lib/parents.ts), so that follower can delete it. */
  byLink?: string;
  /** What that counselor could see when writing it: a note can quote anything up to this level. */
  authorLevel?: "basic" | "standard" | "full";
};

export type EssayAiCheck = {
  checkedAt: number;
  verdict: "ai" | "mixed" | "human";
  ai: number;
  mixed: number;
  human: number;
  /** Words in the draft that was checked. */
  words: number;
};

export type ShareMeta = {
  token: string;
  label: string;
  /** "progress": applications, decisions and follow-ups only (parents, counselors). "full": the whole hub (advisors). */
  scope?: "progress" | "full";
  createdAt: number;
  revokedAt?: number;
};

export type Workspace = {
  /** Increases with each committed mutation for ordering responses in the UI. */
  revision: number;
  /** Non-secret namespace for recovering unsaved drafts in this browser. */
  draftStorageKey: string;
  applicant: {
    name: string; cycle: string; year: string;
    gpaWeighted: string; gpaUnweighted: string; sat: string; satNote: string; awards: number;
    /** Grades rising, steady or falling across high school (lib/college-recommendations.ts uses "up"). */
    gpaTrend?: "up" | "steady" | "down";
    /** Unweighted GPA for 10th-11th grade only (what the UCs use), when the transcript shows it. */
    gpaRecent?: string;
  };
  profile: {
    intended: string; hs: string; gradYear: number | string; location: string;
    counselor: string; residency: string;
    /** act: ACT composite as text ("—" or missing when none). */
    testing: { sat: string; satNote: string; act?: string; aps: APScore[] };
    coursework: { honors: string[]; aps: string[]; senior: string[] };
    activities: Activity[];
    honors: Honor[];
    /** Majors the student plans to switch into after applying as `intended` (the decision board only). */
    switchTo?: string;
    /** Why, in the student's words (the decision board only). */
    pathNote?: string;
  };
  ed: null | { school: string; deadline: string; daysLeft: number | string; reason: string };
  /** source "student": added or edited on the Timeline; AI rewrites keep these. */
  criticalDates: { date: string; label: string; detail: string; source?: "student" }[];
  colleges: College[];
  /** List schools whose application the student removed while keeping the school on the list (lib/list-sync.ts). */
  noApplication?: string[];
  essays: { commonApp: Essay[]; supplements: Record<string, Essay[]> };
  /** Writing status by essay id. Missing means not marked; the Essays tab treats text as a draft. */
  essayStatus?: Record<string, EssayStatus>;
  /** Essays the student hid (essay id → true). Hidden essays keep their drafts and leave every count. */
  essayHidden?: Record<string, true>;
  /** Which option (0-based) of a choose-one prompt the student answers, by essay id. */
  essayOption?: Record<string, number>;
  /**
   * Schools the student is not writing supplements for, by Essays group key (a college slug or "uc-application")
   * -> false. Every other school is an essay school. Opted-out schools' essays hide and leave every count; drafts are kept.
   */
  essaySchools?: Record<string, false>;
  /** The Common App personal essay prompt the student chose (a ca-ps-* id). The other five are then hidden. */
  commonAppPrompt?: string;
  /** Copilot suggestions by essay id (suggest_essay_edit). */
  essaySuggestions?: Record<string, EssaySuggestion>;
  /** Draft text keyed by essay id — server-persisted (not localStorage). */
  essayDrafts: Record<string, string>;
  /** The latest GPTZero check by essay id (app/api/gptzero/scan): totals only, the student's alone. */
  essayAiChecks?: Record<string, EssayAiCheck>;
  /** Planner checkbox state keyed by task id. */
  plannerDone: Record<string, boolean>;
  /** Old per-school status, kept only so older workspaces migrate into `tracker`. */
  applications: Record<string, ApplicationEntry>;
  /** Applications tracker: every school applied to, its status, dates and last portal check. */
  tracker: Tracker;
  recommendations: Recommendation[];
  scholarships: Scholarship[];
  financialAid: FinancialAid;
  /** Read-only advisor comments (also writable via share page). */
  advisorNotes: AdvisorNote[];
  /** Active share link metadata (tokens themselves live in share-store). */
  shares: ShareMeta[];
  /** Multi-device recovery code (also indexed in share-store recovery/). */
  recoveryCode?: string;
  uploads: UploadMeta[];
  onboarding: OnboardingState;
  /** What the AI took from the whole application on the last chance estimate. */
  applicationRead?: ApplicationRead;
  /** Chance estimates by target key: a shortlist slug, or "app:<tracker id>" (lib/admission-odds.ts). */
  admissionOdds?: Record<string, AdmissionOdds>;
  /** Scorecard admission numbers for tracked schools, by tracker id (lib/school-stats.ts). */
  schoolStats?: Record<string, SchoolStats>;
  /** Career-ranking majors, weights and adjustments (lib/career-settings.ts), shared by the website and the app. */
  careerSettings?: unknown;
  /** Private calendar subscription (lib/calendar-feed.ts). The token is the feed's only credential. */
  calendarFeed?: { token: string; createdAt: number };
  /** The AI's two picks among admitted schools (lib/decision-board.ts). The student's alone: never in share links. */
  decisionBoard?: unknown;
};

export function emptyWorkspace(): Workspace {
  return {
    revision: 0,
    draftStorageKey: randomUUID(),
    applicant: {
      name: "", cycle: "", year: "",
      gpaWeighted: "—", gpaUnweighted: "—", sat: "—", satNote: "", awards: 0,
    },
    profile: {
      intended: "", hs: "", gradYear: "", location: "", counselor: "", residency: "",
      testing: { sat: "—", satNote: "", aps: [] },
      coursework: { honors: [], aps: [], senior: [] },
      activities: [],
      honors: [],
    },
    ed: null,
    criticalDates: [],
    colleges: [],
    essays: {
      commonApp: COMMON_APP_PERSONAL_PROMPTS.map((e) => ({ ...e })),
      supplements: {},
    },
    essayDrafts: {},
    plannerDone: {},
    applications: {},
    tracker: emptyTracker(),
    recommendations: [],
    scholarships: [],
    financialAid: {
      fafsaStatus: "not_started",
      cssStatus: "not_started",
      idocStatus: "n_a",
    },
    advisorNotes: [],
    shares: [],
    uploads: [],
    onboarding: { completed: false },
  };
}

/** True while the full-screen onboarding wizard should block the hub. */
export function needsOnboarding(ws: Workspace): boolean {
  if (ws.onboarding?.completed) return false;
  // An interview in progress reopens by itself, even after the student's name is saved.
  if (ws.onboarding?.interview && ws.onboarding.interview.phase !== "done") return true;
  if ((ws.applicant?.name || "").trim()) return false;
  if ((ws.colleges?.length || 0) > 0) return false;
  if ((ws.profile?.activities?.length || 0) > 0) return false;
  return true;
}

function presentStat(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return Boolean(s) && s !== "—";
}

/**
 * Server-side unlock rule (matches the wizard): identity + ≥1 GPA.
 * College list is optional at unlock — the onboarding AI builds a preliminary list.
 */
export function canCompleteOnboarding(ws: Workspace): { ok: true } | { ok: false; error: string } {
  const name = (ws.applicant?.name || "").trim();
  if (!name) return { ok: false, error: "Name is required." };
  const hs = (ws.profile?.hs || "").trim();
  if (!hs) return { ok: false, error: "High school is required." };
  const intended = (ws.profile?.intended || "").trim();
  if (!intended) return { ok: false, error: "Intended major is required." };
  const gradYear = ws.profile?.gradYear;
  const cycle = (ws.applicant?.cycle || "").trim();
  const year = (ws.applicant?.year || "").trim();
  if (!gradYear && !cycle && !year) {
    return { ok: false, error: "Graduation year or application cycle is required." };
  }
  if (!presentStat(ws.applicant?.gpaWeighted) && !presentStat(ws.applicant?.gpaUnweighted)) {
    return { ok: false, error: "At least one GPA (weighted or unweighted) is required." };
  }
  return { ok: true };
}

// ── Storage driver ────────────────────────────────────────────────────────

function useBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function dataDir(): string {
  return process.env.CF_DATA_DIR
    ? path.resolve(process.env.CF_DATA_DIR)
    : path.join(process.cwd(), "data");
}

async function readBlobText(key: string): Promise<{ text: string; etag: string } | null> {
  const { get } = await import("@vercel/blob");
  // Bypass the cache: the body and ETag must describe the same current version.
  // Compressed JSON responses carry a weak transfer ETag, which cannot be used
  // for ifMatch. Identity encoding preserves the stored blob’s strong ETag.
  const res = await get(key, { access: "private", useCache: false, headers: { "accept-encoding": "identity" } });
  if (res === null) return null;
  if (res.statusCode !== 200 || !res.stream) {
    throw new Error(`Unexpected workspace storage response: ${res.statusCode}`);
  }
  return { text: await new Response(res.stream).text(), etag: res.blob.etag };
}

async function readText(key: string): Promise<string | null> {
  if (useBlob()) return (await readBlobText(key))?.text ?? null;
  try {
    return await fs.readFile(path.join(dataDir(), key), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeLocalText(key: string, text: string): Promise<void> {
  const full = path.join(dataDir(), key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const temporary = `${full}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await fs.rename(temporary, full);
  } finally {
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function writeText(key: string, text: string, contentType: string): Promise<void> {
  if (useBlob()) {
    const { put } = await import("@vercel/blob");
    await put(key, text, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  await writeLocalText(key, text);
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload.txt";
}

async function deleteText(key: string): Promise<void> {
  if (useBlob()) {
    const { del } = await import("@vercel/blob");
    await del(key);
    return;
  }
  await fs.unlink(path.join(dataDir(), key)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

const workspaceKey = (id: string) => `workspaces/${safeId(id)}.json`;
const uploadKey = (id: string, name: string) => `uploads/${safeId(id)}/${safeName(name)}`;
// Kept outside the workspace document so share links, exports and AI context never include it.
const scattergramKey = (id: string) => `scattergrams/${safeId(id)}.json`;
// Same reason: a student's own judged ranking stays out of share links, exports and AI context.
const careerAiKey = (id: string) => `career-ai/${safeId(id)}.json`;

export function newWorkspaceId(): string {
  return randomUUID();
}

/**
 * What every saved workspace keeps true: Essays groups for each list school, dataset prompts as current as
 * lib/supplements/prompts.json, and a valid Common App choice.
 */
function withDerived(ws: Workspace): Workspace {
  return keepValidCommonAppPrompt(syncSuppStatus(syncEssaySupplements(refreshScrapedSupplements(ws))));
}

function normalizeWorkspace(parsed: Partial<Workspace>): { workspace: Workspace; linked: boolean } {
  const empty = emptyWorkspace();
  const base: Workspace = {
    ...empty,
    ...parsed,
    revision: Number.isSafeInteger(parsed.revision) && Number(parsed.revision) >= 0 ? Number(parsed.revision) : 0,
    draftStorageKey: typeof parsed.draftStorageKey === "string" && parsed.draftStorageKey ? parsed.draftStorageKey : empty.draftStorageKey,
    applicant: { ...empty.applicant, ...(parsed.applicant || {}) },
    profile: {
      ...empty.profile,
      ...(parsed.profile || {}),
      testing: { ...empty.profile.testing, ...(parsed.profile?.testing || {}) },
      coursework: { ...empty.profile.coursework, ...(parsed.profile?.coursework || {}) },
    },
    essays: {
      commonApp:
        parsed.essays?.commonApp && parsed.essays.commonApp.length > 0
          ? parsed.essays.commonApp
          : empty.essays.commonApp,
      supplements: parsed.essays?.supplements ?? empty.essays.supplements,
    },
    essayDrafts: parsed.essayDrafts ?? empty.essayDrafts,
    plannerDone: parsed.plannerDone ?? empty.plannerDone,
    applications: parsed.applications ?? empty.applications,
    tracker: parsed.tracker
      ? normalizeTracker(parsed.tracker)
      : migrateOldStatuses(emptyTracker(), parsed.colleges ?? [], parsed.applications ?? {}),
    recommendations: parsed.recommendations ?? empty.recommendations,
    scholarships: parsed.scholarships ?? empty.scholarships,
    financialAid: { ...empty.financialAid, ...(parsed.financialAid || {}) },
    advisorNotes: parsed.advisorNotes ?? empty.advisorNotes,
    shares: parsed.shares ?? empty.shares,
    onboarding: { ...empty.onboarding, ...(parsed.onboarding || {}) },
  };
  // A malformed essayAiChecks (not a plain object) is dropped rather than trusted.
  const clean: Workspace =
    "essayAiChecks" in base && (!base.essayAiChecks || typeof base.essayAiChecks !== "object" || Array.isArray(base.essayAiChecks))
      ? (({ essayAiChecks: _bad, ...rest }) => rest)(base)
      : base;
  // Every application gets a list school and every kept list school an application (lazy migration),
  // then Essays groups for every college on the list.
  const linked = linkListAndApplications(clean);
  return { workspace: withDerived(linked), linked: linked !== clean };
}

type WorkspaceMutation = (workspace: Workspace) => Workspace | Promise<Workspace>;
const WORKSPACE_RETRIES = 12;
const LOCAL_LOCK_WAIT_MS = 5000;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function decodeWorkspace(raw: string | null): { workspace: Workspace; needsWrite: boolean } {
  if (raw === null) return { workspace: emptyWorkspace(), needsWrite: true };
  let parsed: Partial<Workspace>;
  try {
    parsed = JSON.parse(raw) as Partial<Workspace>;
  } catch {
    throw new Error("Stored workspace JSON is invalid; existing data was not changed.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored workspace must be a JSON object; existing data was not changed.");
  }
  const { workspace, linked } = normalizeWorkspace(parsed);
  // A workspace from before the tracker, or with applications the list sync just added, is saved once so ids stay stable.
  return { workspace, needsWrite: parsed.draftStorageKey !== workspace.draftStorageKey || !parsed.tracker || linked };
}

async function withWorkspaceLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = path.join(dataDir(), key) + ".lock";
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCAL_LOCK_WAIT_MS;
  let handle;
  while (!handle) {
    try {
      handle = await fs.open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error("Workspace is busy: timed out waiting for its storage lock. Please retry. If this persists, an interrupted writer may require operator recovery.");
      }
      await wait(15 + Math.floor(Math.random() * 25));
    }
  }
  // Never steal an existing lock: a paused or slow process may still own it.
  // After a process crash, an operator must confirm no writers remain before
  // removing its abandoned .lock file; automatic age-based removal is unsafe.
  try {
    return await operation();
  } finally {
    await handle.close();
    await fs.unlink(lockPath);
  }
}

// Share the queue across route bundles in the same Node process. CAS below still
// protects writers in other processes/instances; this only avoids local contention.
const queueGlobal = globalThis as typeof globalThis & { __cfWorkspaceWrites?: Map<string, Promise<void>> };
const workspaceWriteQueues = queueGlobal.__cfWorkspaceWrites ??= new Map<string, Promise<void>>();
async function queueWorkspaceMutation(id: string, mutate?: WorkspaceMutation): Promise<Workspace> {
  const key = `${useBlob() ? "blob" : dataDir()}:${workspaceKey(id)}`;
  const previous = workspaceWriteQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  workspaceWriteQueues.set(key, current);
  await previous;
  try {
    return await mutateWorkspace(id, mutate);
  } finally {
    release();
    if (workspaceWriteQueues.get(key) === current) workspaceWriteQueues.delete(key);
  }
}

/**
 * Runs a mutation, then keeps the list and applications in step (lib/list-sync.ts) and the derived essay
 * data current, so every writer (hub, iOS, copilot, MCP, imports, rebalance) behaves the same.
 */
async function applyMutation(workspace: Workspace, mutate: WorkspaceMutation): Promise<Workspace> {
  return withDerived(syncListAndApplications(workspace, await mutate(workspace)));
}

/**
 * After a write: applications it removed (by any writer, including the list sync dropping an untouched one)
 * lose their saved login, master-login use and set-up details. The write already happened, so a failure here
 * is logged rather than reported as a failed write.
 */
async function cleanupRemoved(id: string, before: Workspace, after: Workspace): Promise<void> {
  const removed = removedAppIds(before, after);
  if (!removed.length) return;
  try {
    await cleanupApps(id, removed);
  } catch (error) {
    console.error("[store] cleanup of removed applications failed", { count: removed.length, error: error instanceof Error ? error.name : "unknown" });
  }
}

async function mutateWorkspace(id: string, mutate?: WorkspaceMutation): Promise<Workspace> {
  const key = workspaceKey(id);
  if (!useBlob()) {
    return withWorkspaceLock(key, async () => {
      const { workspace, needsWrite } = decodeWorkspace(await readText(key));
      const revision = workspace.revision;
      const next = mutate ? { ...await applyMutation(workspace, mutate), revision: revision + 1 } : workspace;
      if (mutate || needsWrite) await writeLocalText(key, JSON.stringify(next, null, 2));
      await cleanupRemoved(id, workspace, next);
      return next;
    });
  }

  const { put, BlobError, BlobPreconditionFailedError } = await import("@vercel/blob");
  for (let attempt = 0; attempt < WORKSPACE_RETRIES; attempt++) {
    const snapshot = await readBlobText(key);
    const { workspace, needsWrite } = decodeWorkspace(snapshot?.text ?? null);
    if (!mutate && !needsWrite) return workspace;
    if (snapshot && !snapshot.etag) throw new Error("Workspace storage did not return an ETag; update was not attempted.");
    if (snapshot && /^W\//i.test(snapshot.etag)) throw new Error("Workspace storage returned a weak ETag; conditional update was not attempted.");
    const revision = workspace.revision;
    const next = mutate ? { ...await applyMutation(workspace, mutate), revision: revision + 1 } : workspace;
    try {
      await put(key, JSON.stringify(next, null, 2), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        ...(snapshot ? { allowOverwrite: true, ifMatch: snapshot.etag } : { allowOverwrite: false }),
      });
      await cleanupRemoved(id, workspace, next);
      return next;
    } catch (error) {
      const versionConflict = error instanceof BlobPreconditionFailedError;
      // SDK 2.x reports create-only collisions as BlobError, not a distinct class.
      const createConflict = !snapshot && error instanceof BlobError && /already exists/i.test(error.message);
      const operationConflict = error instanceof BlobError && error.message ===
        "Vercel Blob: The conditional request cannot succeed due to a conflicting operation against this resource.";
      if (!versionConflict && !createConflict && !operationConflict) throw error;
      if (attempt === WORKSPACE_RETRIES - 1) {
        throw new Error("Workspace changed too often to save after repeated conflicts. Please retry.");
      }
      await wait(Math.min(100, 5 * 2 ** attempt) + Math.floor(Math.random() * 20));
    }
  }
  throw new Error("Workspace update retry limit reached.");
}

/**
 * Copies an anonymous workspace (and its uploads) to `newId` when someone signs in. Nothing is deleted
 * here: the caller records the new id on the account first, then calls retireWorkspace. Returns false
 * when nothing was stored under the old id.
 */
export async function copyWorkspace(anonymousId: string, newId: string): Promise<boolean> {
  const raw = await readText(workspaceKey(anonymousId));
  if (raw === null) return false;
  const oldUploads = `uploads/${safeId(anonymousId)}/`;
  for (const key of await listDocs(oldUploads)) {
    const text = await readText(key);
    if (text !== null) await writeText(`uploads/${safeId(newId)}/${key.slice(oldUploads.length)}`, text, "text/plain");
  }
  if ((await readText(workspaceKey(newId))) === null) await writeText(workspaceKey(newId), raw, "application/json");
  return true;
}

/** Deletes an anonymous workspace after it moved to an account, so the old id opens an empty one. */
export async function retireWorkspace(anonymousId: string): Promise<void> {
  const oldUploads = `uploads/${safeId(anonymousId)}/`;
  for (const key of await listDocs(oldUploads)) await deleteText(key);
  await deleteText(workspaceKey(anonymousId));
  await deleteText(scattergramKey(anonymousId)).catch(() => undefined);
}

/** Read only: null when no workspace is stored under this id. Migrations apply in memory and are never written. */
export async function peekWorkspace(id: string): Promise<Workspace | null> {
  const raw = await readText(workspaceKey(id));
  return raw === null ? null : decodeWorkspace(raw).workspace;
}

/** Read without writing unless initialization or a persisted namespace migration is needed. */
export async function getWorkspace(id: string): Promise<Workspace> {
  const { workspace, needsWrite } = decodeWorkspace(await readText(workspaceKey(id)));
  return needsWrite ? queueWorkspaceMutation(id) : workspace;
}

/** Mutations must be replayable: Blob conflicts re-read current data and run them again. */
export async function updateWorkspace(id: string, mutate: WorkspaceMutation): Promise<Workspace> {
  return queueWorkspaceMutation(id, mutate);
}

export async function resetWorkspace(id: string): Promise<Workspace> {
  await deleteScattergramText(id);
  await deleteCareerAiText(id).catch(() => undefined);
  return updateWorkspace(id, () => emptyWorkspace());
}

/** Scattergram imports were removed; a reset still clears any a workspace saved before. */
async function deleteScattergramText(id: string): Promise<void> {
  await deleteText(scattergramKey(id));
}

/** The student's judged ranking file (lib/career-ai.ts), stored as given after validation. */
export async function readCareerAiText(id: string): Promise<string | null> {
  return readText(careerAiKey(id));
}

export async function saveCareerAiText(id: string, text: string): Promise<void> {
  await writeText(careerAiKey(id), text, "application/json");
}

export async function deleteCareerAiText(id: string): Promise<void> {
  await deleteText(careerAiKey(id));
}

export async function saveUpload(id: string, name: string, text: string): Promise<UploadMeta> {
  const file = safeName(name);
  await writeText(uploadKey(id, file), text, "text/plain");
  const meta: UploadMeta = { name: file, chars: text.length, uploadedAt: Date.now() };
  await updateWorkspace(id, (ws) => ({ ...ws, uploads: [...ws.uploads.filter((u) => u.name !== file), meta] }));
  return meta;
}

const UPLOAD_READ_CAP = 60_000;

export async function readUpload(id: string, name: string): Promise<string | null> {
  const raw = await readText(uploadKey(id, name));
  if (raw === null) return null;
  return raw.length <= UPLOAD_READ_CAP ? raw : raw.slice(0, UPLOAD_READ_CAP) + "\n\n[…truncated…]";
}

/**
 * The tracker as the browser may see it in workspace responses: a portal's words for a decision only
 * after the student opened it, and no `decisionSeen` (it contains those words) or decision letter metadata.
 */
export function redactTracker(tracker: Tracker): Tracker {
  return {
    ...tracker,
    apps: tracker.apps.map((app) => {
      // Letter metadata carries the outcome and award amounts: only the student's own tracker views show it.
      const { decisionSeen: _d, letters: _l, ...rest } = app;
      const portal = shownPortal(app);
      return portal ? { ...rest, portal } : rest;
    }),
  };
}

/** Any response body that carries a workspace (directly or as `data`), with its tracker redacted. */
export function redactWorkspaceBody<T>(body: T): T {
  if (!body || typeof body !== "object") return body;
  const b = body as Record<string, unknown>;
  if (b.tracker && typeof b.tracker === "object" && Array.isArray((b.tracker as Tracker).apps)) {
    return { ...b, tracker: redactTracker(b.tracker as Tracker) } as T;
  }
  if (b.data && typeof b.data === "object") return { ...b, data: redactWorkspaceBody(b.data) } as T;
  return body;
}

/**
 * What a full share link (public/hub/share.html) gets, picked field by field so anything added to the workspace
 * later stays out. Never: onboarding answers, recovery codes, share tokens, uploads, calendar feeds, AI estimates,
 * GPTZero checks, copilot suggestions, the decision board, hidden essays and their drafts, or coach and counselor notes.
 */
export function publicShareView(ws: Workspace) {
  const a = ws.applicant;
  const p = ws.profile;
  return {
    applicant: { name: a.name, cycle: a.cycle, year: a.year, gpaWeighted: a.gpaWeighted, gpaUnweighted: a.gpaUnweighted, sat: a.sat, awards: a.awards },
    profile: { intended: p.intended, hs: p.hs, gradYear: p.gradYear, location: p.location, counselor: p.counselor, activities: p.activities },
    ed: ws.ed ? { school: ws.ed.school, deadline: ws.ed.deadline } : null,
    criticalDates: ws.criticalDates.map(({ date, label, detail }) => ({ date, label, detail })),
    colleges: ws.colleges.map(({ slug, name, short, tier, deadline, deadlines }) => ({ slug, name, short, tier, deadline, deadlines })),
    // Statuses only: never a decision the student hasn't revealed, a login or an aid offer.
    tracker: { apps: ws.tracker.apps.map(({ slug, status }) => ({ slug, status })) },
    recommendations: ws.recommendations.map(({ id, name, type, status, deadline }) => ({ id, name, type, status, deadline })),
    // A school's own award amount stays with the student (lib/aid-validate.ts).
    scholarships: ws.scholarships.map(({ notes: _n, ...s }) => sharedScholarship(s)),
    financialAid: { fafsaStatus: ws.financialAid.fafsaStatus, cssStatus: ws.financialAid.cssStatus },
    // Hidden essays, opted-out schools and unchosen Common App prompts, with their drafts, never leave the server.
    ...visibleEssays(ws),
    // Notes left through share links only (older ones have no via): a coach's or counselor's comments are theirs and the student's.
    advisorNotes: ws.advisorNotes
      .filter((n) => !n.via || n.via === "full" || n.via === "progress")
      .map(({ id, body, author, createdAt, essayId, via }) => ({ id, body, author, createdAt, essayId, via })),
    onboarding: { completed: ws.onboarding.completed },
  };
}
