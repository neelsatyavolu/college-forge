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
  /** Increases with each committed mutation for ordering responses in the UI. */
  revision: number;
  /** Non-secret namespace for recovering unsaved drafts in this browser. */
  draftStorageKey: string;
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
  const workspace = normalizeWorkspace(parsed);
  return { workspace, needsWrite: parsed.draftStorageKey !== workspace.draftStorageKey };
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

async function mutateWorkspace(id: string, mutate?: WorkspaceMutation): Promise<Workspace> {
  const key = workspaceKey(id);
  if (!useBlob()) {
    return withWorkspaceLock(key, async () => {
      const { workspace, needsWrite } = decodeWorkspace(await readText(key));
      const revision = workspace.revision;
      const next = mutate ? { ...await mutate(workspace), revision: revision + 1 } : workspace;
      if (mutate || needsWrite) await writeLocalText(key, JSON.stringify(next, null, 2));
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
    const next = mutate ? { ...await mutate(workspace), revision: revision + 1 } : workspace;
    try {
      await put(key, JSON.stringify(next, null, 2), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        ...(snapshot ? { allowOverwrite: true, ifMatch: snapshot.etag } : { allowOverwrite: false }),
      });
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
  return updateWorkspace(id, () => emptyWorkspace());
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
