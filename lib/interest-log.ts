import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { COLLEGES } from "./catalog";
import { loadSchoolResearch, type ResearchFact } from "./school-research";
import { matchCatalog, statusInfo, type TrackedApp, type Tracker } from "./tracker";

/**
 * Demonstrated interest and interviews, per school: visits, info sessions, fairs, interviews and contact with
 * the regional admissions officer. Every helper returns a new object. What a school says about interest and
 * interviews comes only from its sourced research facts (CDS C7 and the admissions site), never from a guess.
 */

export const INTEREST_KINDS = ["visit", "virtual_session", "info_session", "fair", "interview", "ao_contact", "email_opened", "other"] as const;
export type InterestKind = (typeof INTEREST_KINDS)[number];

export const INTEREST_LABELS: Record<InterestKind, string> = {
  visit: "Campus visit",
  virtual_session: "Virtual session",
  info_session: "Info session",
  fair: "College fair",
  interview: "Interview",
  ao_contact: "Admissions officer contact",
  email_opened: "Opened their emails",
  other: "Other",
};

export const MAX_INTEREST = 50;
const MAX_WHO = 120;
const MAX_NOTES = 1000;
const MAX_PREP = 4000;

export interface InterestEvent {
  id: string;
  kind: InterestKind;
  /** yyyy-mm-dd */
  date: string;
  /** HH:MM, 24-hour, local to the student. */
  time?: string;
  /** Interviewer, regional officer or event name. */
  who?: string;
  notes?: string;
  /** Interview prep the copilot drafted: likely questions and talking points from the student's own material. */
  prep?: string;
  /** Interviews only: whether a thank-you note went out. */
  thankYouSent?: boolean;
  done: boolean;
  createdAt: number;
}

/** User-facing input problems. The service turns these into TrackerError. */
export class InterestError extends Error {}

export interface InterestInput {
  kind?: string;
  date?: string;
  time?: string;
  who?: string;
  notes?: string;
  prep?: string;
  thankYouSent?: boolean;
  done?: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isKind = (v: unknown): v is InterestKind => typeof v === "string" && (INTEREST_KINDS as readonly string[]).includes(v);
const validDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const oneLine = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const block = (v: unknown, max: number) => String(v ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);

/** Validates the fields given; throws InterestError with a message meant for the student. */
export function cleanInterest(input: InterestInput): Partial<InterestEvent> {
  const out: Partial<InterestEvent> = {};
  if (input.kind !== undefined) {
    if (!isKind(input.kind)) throw new InterestError(`Unknown kind "${input.kind}". Use one of: ${INTEREST_KINDS.join(", ")}.`);
    out.kind = input.kind;
  }
  if (input.date !== undefined) {
    if (!validDate(input.date)) throw new InterestError("Date must be a real yyyy-mm-dd date.");
    out.date = input.date;
  }
  if (input.time !== undefined) {
    if (input.time !== "" && !TIME.test(input.time)) throw new InterestError("Time must be HH:MM (24-hour) or empty.");
    out.time = input.time;
  }
  if (input.who !== undefined) out.who = oneLine(input.who, MAX_WHO);
  if (input.notes !== undefined) out.notes = block(input.notes, MAX_NOTES);
  if (input.prep !== undefined) out.prep = block(input.prep, MAX_PREP);
  if (input.thankYouSent !== undefined) {
    if (typeof input.thankYouSent !== "boolean") throw new InterestError("thankYouSent must be true or false.");
    out.thankYouSent = input.thankYouSent;
  }
  if (input.done !== undefined) {
    if (typeof input.done !== "boolean") throw new InterestError("done must be true or false.");
    out.done = input.done;
  }
  return out;
}

/** Drops empty optional strings so stored events stay small. */
function compact(e: InterestEvent): InterestEvent {
  const { time, who, notes, prep, thankYouSent, ...rest } = e;
  return {
    ...rest,
    ...(time ? { time } : {}),
    ...(who ? { who } : {}),
    ...(notes ? { notes } : {}),
    ...(prep ? { prep } : {}),
    ...(e.kind === "interview" && thankYouSent !== undefined ? { thankYouSent } : {}),
  };
}

/** Stored events that still have a valid shape (older or hand-edited data is skipped, not trusted). */
export function interestOf(app: TrackedApp): InterestEvent[] {
  const list: unknown = app.interest;
  if (!Array.isArray(list)) return [];
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return list.flatMap((raw): InterestEvent[] => {
    if (!raw || typeof raw !== "object") return [];
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== "string" || !isKind(e.kind) || typeof e.date !== "string" || !validDate(e.date)) return [];
    const time = str(e.time);
    return [compact({
      id: e.id,
      kind: e.kind,
      date: e.date,
      time: time && TIME.test(time) ? time : undefined,
      who: str(e.who),
      notes: str(e.notes),
      prep: str(e.prep),
      thankYouSent: typeof e.thankYouSent === "boolean" ? e.thankYouSent : e.kind === "interview" ? false : undefined,
      done: e.done === true,
      createdAt: typeof e.createdAt === "number" ? e.createdAt : 0,
    })];
  });
}

/**
 * A past date counts as done unless said otherwise. An interview counts as done only once its day has passed,
 * so one booked for later today stays on the calendar and doesn't ask for a thank-you note yet.
 */
export function addInterest(app: TrackedApp, input: InterestInput, today: string, now = Date.now()): TrackedApp {
  const list = interestOf(app);
  if (list.length >= MAX_INTEREST) throw new InterestError(`Already ${MAX_INTEREST} entries for this school. Remove some first.`);
  if (input.kind === undefined || input.date === undefined) throw new InterestError("Give the kind and the date.");
  const clean = cleanInterest(input);
  const event = compact({
    id: randomUUID().slice(0, 8),
    kind: clean.kind!,
    date: clean.date!,
    time: clean.time,
    who: clean.who,
    notes: clean.notes,
    prep: clean.prep,
    thankYouSent: clean.kind === "interview" ? (clean.thankYouSent ?? false) : undefined,
    done: clean.done ?? (clean.kind === "interview" ? clean.date! < today : clean.date! <= today),
    createdAt: now,
  });
  return { ...app, interest: sortEvents([...list, event]), updatedAt: now };
}

export function setInterest(app: TrackedApp, id: string, change: InterestInput & { remove?: boolean }, now = Date.now()): TrackedApp {
  const list = interestOf(app);
  if (!list.some((e) => e.id === id)) throw new InterestError("No interest entry with that id on this application.");
  if (change.remove) return { ...app, interest: list.filter((e) => e.id !== id), updatedAt: now };
  const { remove: _r, ...fields } = change;
  const clean = cleanInterest(fields);
  const interest = list.map((e) => {
    if (e.id !== id) return e;
    const kind = clean.kind ?? e.kind;
    const thankYouSent = kind === "interview" ? (clean.thankYouSent ?? e.thankYouSent ?? false) : undefined;
    return compact({ ...e, ...clean, kind, thankYouSent });
  });
  return { ...app, interest: sortEvents(interest), updatedAt: now };
}

const sortKey = (e: InterestEvent) => `${e.date} ${e.time || "99:99"}`;
const sortEvents = (list: InterestEvent[]) => [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

// ── What the school says (sourced research) ───────────────────────────────────

export type InterestPolicy = "important" | "considered" | "not_considered" | "unknown";
export type InterviewPolicy = "evaluative" | "informational" | "by_invitation" | "not_offered" | "unknown";

/** Reads the CDS C7 "level of applicant's interest" rating, or a school's own statement, from a research fact. */
export function parseInterestPolicy(text: string | undefined): InterestPolicy {
  const t = String(text ?? "").toLowerCase();
  if (!t.trim()) return "unknown";
  // Ratings of other C7 rows ("interview 'considered'") come after a semicolon or inside parentheses; read the lead.
  const lead = t.replace(/\binterviews?\b[^;).]*/g, " ");
  // A value that opens with the rating says it plainly ("Considered: ... calls ED an important signal").
  const opening = lead.trim().match(/^(very important|important|considered|not considered)\b/);
  if (opening) return opening[1] === "not considered" ? "not_considered" : opening[1] === "considered" ? "considered" : "important";
  if (/\bnot (considered|tracked|used|a factor)\b|\bdoes not (track|consider|make decisions)\b|\bnot applicable\b|\bzero bearing\b/.test(lead)) return "not_considered";
  if (/\bnot rated\b|\bleft blank\b/.test(lead)) return "unknown";
  if (/\b(very )?important\b/.test(lead)) return "important";
  if (/\bconsider(ed|ing|s)?\b|\btracks\b/.test(lead)) return "considered";
  return "unknown";
}

/** Whether a school offers interviews and whether they count, from its research fact. */
export function parseInterviewPolicy(text: string | undefined): InterviewPolicy {
  const t = String(text ?? "").toLowerCase();
  if (!t.trim()) return "unknown";
  if (/\b(discontinued|no longer (offers?|conducts?)|stopped (offering|admissions? interviews|interviews)|ended)\b/.test(t)) return "not_offered";
  if (/\bby invitation\b|\binvit(ed|ation) only\b|\bif (you are |you're )?(invited|assigned)\b|\bwhen assigned\b|\bmay be offered\b|\binterview possible\b/.test(t)) return "by_invitation";
  if (/\bnot evaluative\b|\binformational\b|\binformal\b|\bno evaluative\b|\bno disadvantage\b|\bconversations?\b/.test(t) && !/\band evaluative\b/.test(t)) return "informational";
  if (/^no\b/.test(t)) return "not_offered";
  if (
    /^(not\b|none\b)|^interviews?\b[^;]*\bnot considered\b|\bno (general |admissions? |alumni |on-campus |evaluative )*interviews?\b|\binterviews? (are )?not offered\b|\bnot part of\b|\binterview step\b|\bnot (listed|required) (among|and)\b/.test(t) &&
    !/\b(encouraged|recommended)\b|\boptional\b(?! [^;]*video)/.test(t)
  ) return "not_offered";
  const plain = t.replace(/\bnot required\b/g, " ");
  if (
    /\bevaluative\b|\brequired\b|\bevaluated\b|\bpart of (the application|the file|holistic review)\b|\bconsiderable weight\b|\b(encouraged|recommended)\b|\bexpected\b/.test(plain) ||
    /\b(rates|rated|lists) (the )?interview (as )?'?(very )?important\b|\brated '?(very )?important\b/.test(plain)
  ) return "evaluative";
  if (/\boptional\b|\boffered\b|\bavailable\b|\bschedule\b/.test(t)) return "informational";
  if (/\bconsidered\b/.test(t) && !/\bnot considered\b/.test(t)) return "evaluative";
  return "unknown";
}

type FactLike = Pick<ResearchFact, "key" | "value" | "sourceUrl">;
export interface ResearchLike {
  facts: FactLike[];
}

let byCatalogId: Map<string, string> | null = null;
/** Research slugs by catalog id, so "Tulane University" finds "Tulane University of Louisiana". */
function researchSlugByCatalog(): Map<string, string> {
  if (byCatalogId) return byCatalogId;
  byCatalogId = new Map();
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "school-research", "manifest.json"), "utf8")) as { schools: { slug: string; name: string; website?: string }[] };
    const host = (w: string | undefined) => String(w ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    for (const s of manifest.schools) {
      const site = host(s.website);
      const id = matchCatalog(s.name)?.id ?? (site ? COLLEGES.find((c) => host(c.website) === site)?.id : undefined);
      if (id && !byCatalogId.has(id)) byCatalogId.set(id, s.slug);
    }
  } catch {
    // no manifest: only slug and name lookups
  }
  return byCatalogId;
}

const curatedCache = new Map<string, ResearchLike | null>();
/** The curated research file for a tracked school, by its shortlist slug, name or catalog id; null when Forge has none. */
export function curatedResearchFor(app: Pick<TrackedApp, "slug" | "name" | "collegeId">): ResearchLike | null {
  const key = `${app.slug ?? ""}|${app.name}|${app.collegeId ?? ""}`;
  if (curatedCache.has(key)) return curatedCache.get(key)!;
  const viaCatalog = app.collegeId ? researchSlugByCatalog().get(app.collegeId) : undefined;
  const found = (app.slug ? loadSchoolResearch(app.slug) : null) ?? loadSchoolResearch(app.name) ?? (viaCatalog ? loadSchoolResearch(viaCatalog) : null);
  curatedCache.set(key, found);
  return found;
}

export interface InterestSignal {
  counts: InterestPolicy;
  interview: InterviewPolicy;
  /** The sourced words behind each, with the page they came from. */
  countsFact: { text: string; sourceUrl: string } | null;
  interviewFact: { text: string; sourceUrl: string } | null;
  logged: number;
  interviewsLogged: number;
  thankYouOwed: number;
  nudge?: string;
}

const factFor = (research: ResearchLike | null | undefined, key: string) => {
  const f = research?.facts?.find((x) => x.key === key && typeof x.value === "string" && x.value.trim());
  return f ? { text: f.value, sourceUrl: f.sourceUrl } : null;
};

/** What the school says about interest and interviews, what the student has logged, and one nudge if one is due. */
export function interestSignal(app: TrackedApp, research: ResearchLike | null | undefined): InterestSignal {
  const events = interestOf(app);
  const countsFact = factFor(research, "demonstrated_interest");
  const interviewFact = factFor(research, "interview");
  const counts = parseInterestPolicy(countsFact?.text);
  const interview = parseInterviewPolicy(interviewFact?.text);
  const interviews = events.filter((e) => e.kind === "interview");
  const owed = interviews.filter((e) => e.done && !e.thankYouSent).length;
  const stage = statusInfo(app.status).stage;
  const open = stage === "working" || stage === "waiting";
  let nudge: string | undefined;
  if (owed) nudge = owed === 1 ? "Send your interviewer a thank-you note." : `Send ${owed} interview thank-you notes.`;
  else if (open && events.length === 0 && counts === "important") nudge = "Counts interest as important; nothing logged yet.";
  else if (open && events.length === 0 && counts === "considered") nudge = "Counts interest; nothing logged yet.";
  else if (stage === "working" && interview === "evaluative" && interviews.length === 0) nudge = "Interviews count here; none scheduled yet.";
  return { counts, interview, countsFact, interviewFact, logged: events.length, interviewsLogged: interviews.length, thankYouOwed: owed, ...(nudge ? { nudge } : {}) };
}

// ── Across schools ─────────────────────────────────────────────────────────────

export interface InterestRow {
  appId: string;
  school: string;
  event: InterestEvent;
}

const rows = (tracker: Tracker, keep: (e: InterestEvent) => boolean): InterestRow[] =>
  tracker.apps.flatMap((a) => interestOf(a).filter(keep).map((event) => ({ appId: a.id, school: a.name, event })));

/** Interviews from today on that haven't happened, soonest first. */
export function upcomingInterviews(tracker: Tracker, today: string): InterestRow[] {
  return rows(tracker, (e) => e.kind === "interview" && !e.done && e.date >= today).sort((x, y) => sortKey(x.event).localeCompare(sortKey(y.event)));
}

/** Interviews that happened with no thank-you note sent yet, oldest first. */
export function thankYousOwed(tracker: Tracker): InterestRow[] {
  return rows(tracker, (e) => e.kind === "interview" && e.done && !e.thankYouSent).sort((x, y) => sortKey(x.event).localeCompare(sortKey(y.event)));
}

/** Interviews and visits still ahead, for the calendar. */
export function calendarInterest(tracker: Tracker, today: string): InterestRow[] {
  return rows(tracker, (e) => !e.done && e.date >= today && (e.kind === "interview" || e.kind === "visit" || e.kind === "info_session" || e.kind === "virtual_session" || e.kind === "fair"));
}
