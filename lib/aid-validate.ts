import type { FinancialAid, Scholarship, Workspace } from "./store";

/**
 * Boundary checks for scholarships, the workspace financial-aid checklist and a school's aid offer.
 * Shared by PATCH /api/workspace, the copilot tools and the applications route, so every writer gets
 * the same rules and the same student-facing messages.
 */

export const SCHOLARSHIP_STATUSES = ["researching", "in_progress", "submitted", "won", "lost", "skipped"] as const;
export const SCHOLARSHIP_KINDS = ["outside", "school"] as const;
export const FAFSA_STATUSES = ["not_started", "in_progress", "submitted", "processed"] as const;
/** CSS Profile and IDOC: the FAFSA steps plus "n_a" (none of the student's schools use it). */
export const AID_FORM_STATUSES = [...FAFSA_STATUSES, "n_a"] as const;

export const MAX_SCHOLARSHIPS = 200;
const MAX_NAME = 200;
const MAX_AMOUNT = 60;
const MAX_NOTES = 2000;
const MAX_URL = 500;
const MAX_DOLLARS = 1_000_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

/** What a school offered, in whole US dollars per year. Entered by the student; read by the decision board. */
export type AidOffer = {
  /** The school's full cost of attendance (tuition, housing, food, fees). */
  costOfAttendance?: number;
  /** Grants and scholarships from the school: money that is not paid back. */
  grants?: number;
  /** Federal and school loans offered. */
  loans?: number;
  workStudy?: number;
  notes?: string;
  updatedAt: number;
};
const OFFER_AMOUNTS = ["costOfAttendance", "grants", "loans", "workStudy"] as const;
/** "12000", "$12,000" or "12,000.50": commas only in thousands groups. */
const DOLLARS_TEXT = /^\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/;

/** A school's own award (or one tied to a school): its amount comes from a letter and stays with the student. */
export const isSchoolAward = (s: Pick<Scholarship, "kind" | "slug">): boolean => s.kind === "school" || !!s.slug;

/** A scholarship as someone else sees it: no amount on a school's own award. */
export function sharedScholarship<S extends Pick<Scholarship, "kind" | "slug" | "amount">>(s: S): Omit<S, "amount"> & { amount?: string } {
  if (!isSchoolAward(s)) return s;
  const { amount: _private, ...rest } = s;
  return rest;
}

/** The kind after a write: as sent; else a new link makes it the school's, a cleared link an outside one; else unchanged. */
export function linkKind(row: Partial<Pick<Scholarship, "kind" | "slug">>, prev?: Pick<Scholarship, "kind">): Scholarship["kind"] {
  if (row.kind) return row.kind;
  if (row.slug) return "school";
  if (row.slug === "") return "outside";
  return prev?.kind;
}

/**
 * Fills in what older clients leave out of a whole-list save: a row keeps the school link and kind it had
 * (matched by id) unless the row sets them, and a school link without a kind is the school's own award.
 */
export function mergeScholarshipList(saved: Scholarship[], rows: Scholarship[]): Scholarship[] {
  const before = new Map(saved.map((s) => [s.id, s]));
  return rows.map((row) => {
    const prev = before.get(row.id);
    const slug = row.slug !== undefined ? row.slug : prev?.slug;
    const kind = linkKind(row, prev);
    const { slug: _s, kind: _k, ...rest } = row;
    return { ...rest, ...(slug ? { slug } : {}), ...(kind ? { kind } : {}) };
  });
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const oneOf = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === "string" && (list as readonly string[]).includes(v);

export function isWebUrl(v: string): boolean {
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
}

/** A deadline the student may newly write: empty or yyyy-mm-dd on a real date. */
export function isAidDate(v: string): boolean {
  if (v === "") return true;
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function text(label: string, v: unknown, max: number): Checked<string | undefined> {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (typeof v !== "string") return { ok: false, error: `${label} must be text.` };
  if (v.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
  return { ok: true, value: v };
}

/**
 * Checks one scholarship's fields. `whole`: a full row (from a list replacement), so a name is required.
 * Deadlines are checked for shape only here; checkAidAgainstWorkspace decides whether an old free-text
 * deadline may stay. Slugs are checked against the list there too.
 */
export function checkScholarship(raw: unknown, whole: boolean): Checked<Partial<Scholarship>> {
  if (!isObj(raw)) return { ok: false, error: "Each scholarship must be an object." };
  const out: Partial<Scholarship> = {};
  // An empty id means "create" on an upsert (the iOS app sends one).
  if (raw.id !== undefined && raw.id !== null && raw.id !== "") {
    if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(raw.id)) return { ok: false, error: "Scholarship id is not valid." };
    out.id = raw.id;
  }
  const name = text("Scholarship name", raw.name, MAX_NAME);
  if (!name.ok) return name;
  if (name.value !== undefined) {
    if (!name.value.trim() && (whole || raw.name !== undefined)) return { ok: false, error: "Give the scholarship a name." };
    out.name = name.value.trim();
  } else if (whole) return { ok: false, error: "Give the scholarship a name." };
  const amount = text("Scholarship amount", raw.amount, MAX_AMOUNT);
  if (!amount.ok) return amount;
  if (amount.value !== undefined) out.amount = amount.value.trim();
  const notes = text("Scholarship notes", raw.notes, MAX_NOTES);
  if (!notes.ok) return notes;
  if (notes.value !== undefined) out.notes = notes.value;
  // Kept exactly as sent: checkAidAgainstWorkspace lets an older free-text value through only when it is
  // byte-for-byte what the row already has.
  const deadline = text("Scholarship deadline", raw.deadline, MAX_NOTES);
  if (!deadline.ok) return deadline;
  if (deadline.value !== undefined) out.deadline = deadline.value;
  if (raw.status !== undefined && raw.status !== null) {
    if (!oneOf(SCHOLARSHIP_STATUSES, raw.status)) return { ok: false, error: `Scholarship status must be one of ${SCHOLARSHIP_STATUSES.join(", ")}.` };
    out.status = raw.status;
  }
  const url = text("Scholarship link", raw.url, MAX_URL);
  if (!url.ok) return url;
  if (url.value !== undefined) {
    const u = url.value.trim();
    if (u && !isWebUrl(u)) return { ok: false, error: "Scholarship links must start with https:// or http://." };
    out.url = u;
  }
  if (raw.kind !== undefined && raw.kind !== null) {
    if (!oneOf(SCHOLARSHIP_KINDS, raw.kind)) return { ok: false, error: "Scholarship kind must be outside or school." };
    out.kind = raw.kind;
  }
  if (raw.slug !== undefined && raw.slug !== null) {
    if (typeof raw.slug !== "string" || (raw.slug !== "" && !SLUG.test(raw.slug))) return { ok: false, error: "That school isn't on your list." };
    out.slug = raw.slug;
  }
  return { ok: true, value: out };
}

export function checkScholarshipList(raw: unknown): Checked<Scholarship[]> {
  if (!Array.isArray(raw)) return { ok: false, error: "scholarships must be a list." };
  if (raw.length > MAX_SCHOLARSHIPS) return { ok: false, error: `Track at most ${MAX_SCHOLARSHIPS} scholarships.` };
  const rows: Scholarship[] = [];
  for (const [i, item] of raw.entries()) {
    const r = checkScholarship(item, true);
    if (!r.ok) return r;
    rows.push({ ...r.value, id: r.value.id || `sch-${i + 1}`, name: r.value.name!, status: r.value.status || "researching" });
  }
  if (new Set(rows.map((r) => r.id)).size !== rows.length) return { ok: false, error: "Two scholarships share an id." };
  return { ok: true, value: rows };
}

export function checkFinancialAid(raw: unknown): Checked<Partial<FinancialAid>> {
  if (!isObj(raw)) return { ok: false, error: "financialAid must be an object." };
  const out: Partial<FinancialAid> = {};
  if (raw.fafsaStatus !== undefined && raw.fafsaStatus !== null) {
    if (!oneOf(FAFSA_STATUSES, raw.fafsaStatus)) return { ok: false, error: `FAFSA status must be one of ${FAFSA_STATUSES.join(", ")}.` };
    out.fafsaStatus = raw.fafsaStatus;
  }
  for (const [key, label] of [["cssStatus", "CSS Profile"], ["idocStatus", "IDOC"]] as const) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    if (!oneOf(AID_FORM_STATUSES, v)) return { ok: false, error: `${label} status must be one of ${AID_FORM_STATUSES.join(", ")}.` };
    out[key] = v;
  }
  if (raw.fafsaOpenDate !== undefined && raw.fafsaOpenDate !== null) {
    if (typeof raw.fafsaOpenDate !== "string" || !isAidDate(raw.fafsaOpenDate)) return { ok: false, error: "FAFSA open date must be yyyy-mm-dd or empty." };
    out.fafsaOpenDate = raw.fafsaOpenDate;
  }
  const notes = text("Financial aid notes", raw.notes, 4000);
  if (!notes.ok) return notes;
  if (notes.value !== undefined) out.notes = notes.value;
  return { ok: true, value: out };
}

/** Validates an aid offer edit; null clears it. Throws nothing: callers turn the error into their own response. */
export function checkAidOffer(raw: unknown, now = Date.now()): Checked<AidOffer | null> {
  if (raw === null) return { ok: true, value: null };
  if (!isObj(raw)) return { ok: false, error: "Aid offer must be an object." };
  const out: AidOffer = { updatedAt: now };
  for (const key of OFFER_AMOUNTS) {
    const v = raw[key];
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "string" ? (DOLLARS_TEXT.test(v.trim()) ? Number(v.replace(/[$,\s]/g, "")) : NaN) : v;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_DOLLARS) {
      return { ok: false, error: "Aid amounts must be dollar amounts between 0 and 1,000,000." };
    }
    out[key] = Math.round(n);
  }
  const notes = text("Aid offer notes", raw.notes, MAX_NOTES);
  if (!notes.ok) return notes;
  if (notes.value?.trim()) out.notes = notes.value.trim();
  return { ok: true, value: out };
}

type AidPatch = { scholarship?: unknown; scholarships?: unknown; financialAid?: unknown };

/** Shape checks for the aid parts of a workspace patch; returns the cleaned parts. */
export function checkAidPatch<P extends AidPatch>(patch: P): Checked<P> {
  let next: P = patch;
  if (patch.scholarship !== undefined) {
    const r = checkScholarship(patch.scholarship, false);
    if (!r.ok) return r;
    next = { ...next, scholarship: r.value };
  }
  if (patch.scholarships !== undefined) {
    const r = checkScholarshipList(patch.scholarships);
    if (!r.ok) return r;
    next = { ...next, scholarships: r.value };
  }
  if (patch.financialAid !== undefined) {
    const r = checkFinancialAid(patch.financialAid);
    if (!r.ok) return r;
    next = { ...next, financialAid: r.value };
  }
  return { ok: true, value: next };
}

/**
 * Checks that need the saved workspace: a school link must name a school on the list, and a deadline
 * must be yyyy-mm-dd, unless the same scholarship already has that value saved.
 * Returns the error to show, or "" when the patch is fine.
 */
export function checkAidAgainstWorkspace(
  ws: Pick<Workspace, "colleges" | "scholarships">,
  patch: { scholarship?: Partial<Scholarship>; scholarships?: Scholarship[]; colleges?: Pick<Workspace["colleges"][number], "slug">[] },
): string {
  // The list the patch leaves behind: a college added in the same patch counts, one removed doesn't.
  const slugs = new Set((patch.colleges ?? ws.colleges).map((c) => c.slug));
  const saved = new Map(ws.scholarships.map((s) => [s.id, s]));
  const rows = [...(patch.scholarships ?? []), ...(patch.scholarship ? [patch.scholarship] : [])];
  const list = patch.scholarships ?? ws.scholarships;
  const creates = patch.scholarship && !list.some((s) => s.id === patch.scholarship!.id);
  if (creates && list.length >= MAX_SCHOLARSHIPS) return `Track at most ${MAX_SCHOLARSHIPS} scholarships. Remove one first.`;
  for (const row of rows) {
    const before = saved.get(row.id ?? "");
    // A link or deadline the row already had may stay (the school may have left the list since).
    if (row.slug && !slugs.has(row.slug) && before?.slug !== row.slug) return "That school isn't on your list.";
    if (row.deadline !== undefined && !isAidDate(row.deadline) && before?.deadline !== row.deadline) {
      return "Scholarship deadline must be a date (yyyy-mm-dd) or empty.";
    }
  }
  return "";
}
