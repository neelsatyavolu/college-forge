import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { COMMON_APP_PERSONAL_PROMPTS } from "./common-app-prompts";
import { syncEssaySupplements } from "./essay-supplements";

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
};
export type Essay = {
  id: string; group?: string; label: string; prompt: string;
  limit: number; unit: string; starter?: string;
};
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
};

export type OnboardingState = {
  completed: boolean;
  completedAt?: number;
  /** Freeform story from onboarding (activities / awards / other) for the AI. */
  storyNotes?: {
    activities: string;
    awards: string;
    other: string;
  };
  listPrefs?: OnboardingListPrefs;
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
};

export type Scholarship = {
  id: string;
  name: string;
  amount?: string;
  deadline?: string;
  status: "researching" | "in_progress" | "submitted" | "won" | "lost" | "skipped";
  url?: string;
  notes?: string;
};

export type FinancialAid = {
  fafsaStatus: "not_started" | "in_progress" | "submitted" | "processed";
  cssStatus: "not_started" | "in_progress" | "submitted" | "processed" | "n_a";
  fafsaOpenDate?: string;
  notes?: string;
};

export type AdvisorNote = {
  id: string;
  body: string;
  author: string;
  createdAt: number;
  essayId?: string;
};

export type ShareMeta = {
  token: string;
  label: string;
  createdAt: number;
  revokedAt?: number;
};

export type Workspace = {
  applicant: {
    name: string; cycle: string; year: string;
    gpaWeighted: string; gpaUnweighted: string; sat: string; satNote: string; awards: number;
  };
  profile: {
    intended: string; hs: string; gradYear: number | string; location: string;
    counselor: string; residency: string;
    testing: { sat: string; satNote: string; aps: APScore[] };
    coursework: { honors: string[]; aps: string[]; senior: string[] };
    activities: Activity[];
    honors: Honor[];
  };
  ed: null | { school: string; deadline: string; daysLeft: number | string; reason: string };
  criticalDates: { date: string; label: string; detail: string }[];
  colleges: College[];
  essays: { commonApp: Essay[]; supplements: Record<string, Essay[]> };
  /** Draft text keyed by essay id — server-persisted (not localStorage). */
  essayDrafts: Record<string, string>;
  /** Planner checkbox state keyed by task id. */
  plannerDone: Record<string, boolean>;
  /** Per-school application pipeline status. */
  applications: Record<string, ApplicationEntry>;
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
};

export function emptyWorkspace(): Workspace {
  return {
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
    recommendations: [],
    scholarships: [],
    financialAid: {
      fafsaStatus: "not_started",
      cssStatus: "not_started",
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

async function readText(key: string): Promise<string | null> {
  if (useBlob()) {
    try {
      const { get } = await import("@vercel/blob");
      // useCache:false is REQUIRED for read-your-writes datastore semantics.
      const res = await get(key, { access: "private", useCache: false });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      return await new Response(res.stream).text();
    } catch {
      return null;
    }
  }
  try {
    return await fs.readFile(path.join(dataDir(), key), "utf8");
  } catch {
    return null;
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
  const full = path.join(dataDir(), key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, text, "utf8");
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload.txt";
}

const workspaceKey = (id: string) => `workspaces/${safeId(id)}.json`;
const uploadKey = (id: string, name: string) => `uploads/${safeId(id)}/${safeName(name)}`;

export function newWorkspaceId(): string {
  return randomUUID();
}

function normalizeWorkspace(parsed: Partial<Workspace>): Workspace {
  const empty = emptyWorkspace();
  const base: Workspace = {
    ...empty,
    ...parsed,
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
    recommendations: parsed.recommendations ?? empty.recommendations,
    scholarships: parsed.scholarships ?? empty.scholarships,
    financialAid: { ...empty.financialAid, ...(parsed.financialAid || {}) },
    advisorNotes: parsed.advisorNotes ?? empty.advisorNotes,
    shares: parsed.shares ?? empty.shares,
    onboarding: { ...empty.onboarding, ...(parsed.onboarding || {}) },
  };
  // Backfill Essays groups for any college already on the list (lazy migration).
  return syncEssaySupplements(base);
}

export async function getWorkspace(id: string): Promise<Workspace> {
  const raw = await readText(workspaceKey(id));
  if (!raw) return emptyWorkspace();
  try {
    return normalizeWorkspace(JSON.parse(raw) as Partial<Workspace>);
  } catch {
    return emptyWorkspace();
  }
}

export async function saveWorkspace(id: string, ws: Workspace): Promise<void> {
  await writeText(workspaceKey(id), JSON.stringify(ws, null, 2), "application/json");
}

export async function resetWorkspace(id: string): Promise<Workspace> {
  const empty = emptyWorkspace();
  await saveWorkspace(id, empty);
  return empty;
}

export async function saveUpload(id: string, name: string, text: string): Promise<UploadMeta> {
  const file = safeName(name);
  await writeText(uploadKey(id, file), text, "text/plain");
  const meta: UploadMeta = { name: file, chars: text.length, uploadedAt: Date.now() };
  const ws = await getWorkspace(id);
  const uploads = [...ws.uploads.filter((u) => u.name !== file), meta];
  await saveWorkspace(id, { ...ws, uploads });
  return meta;
}

const UPLOAD_READ_CAP = 60_000;

export async function readUpload(id: string, name: string): Promise<string | null> {
  const raw = await readText(uploadKey(id, name));
  if (raw === null) return null;
  return raw.length <= UPLOAD_READ_CAP ? raw : raw.slice(0, UPLOAD_READ_CAP) + "\n\n[…truncated…]";
}

/** Public share payload — strips recovery codes and internal share tokens list details if needed. */
export function publicShareView(ws: Workspace): Omit<Workspace, "recoveryCode" | "shares" | "uploads"> & {
  uploads: { name: string; chars: number }[];
} {
  const { recoveryCode: _r, shares: _s, uploads, ...rest } = ws;
  return {
    ...rest,
    uploads: uploads.map((u) => ({ name: u.name, chars: u.chars })),
  };
}
