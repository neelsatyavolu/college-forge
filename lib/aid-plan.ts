import type { College, Workspace } from "./store";
import { loadSchoolResearch, type ResearchFact } from "./school-research";
import { effectiveRound, statusInfo, todayIso, type TrackedApp } from "./tracker";

/**
 * Which aid forms each school on the Applications tab asks for, derived on read from the audited research
 * facts (lib/school-research/*.json, or the copy saved on the college) and the school's aid deadlines.
 * Nothing here is stored, so it never goes stale against the research.
 */

export type CssNeed = "required" | "not_required" | "unknown";
export type AidDeadline = { plan: string; date: string; kind: "aid" | "scholarship" };
export type AidTodo = { text: string; due: string };

export type AidRow = {
  appId: string;
  name: string;
  slug: string | null;
  ignoreAid: boolean;
  css: CssNeed;
  idoc: boolean;
  cssNote: string;
  cssSource: string;
  cssCheckedAt: string;
  meetsFullNeed?: string;
  meritAid?: string;
  deadlines: AidDeadline[];
  /** Open follow-ups on this school that are about aid. */
  followUps: { id: string; text: string; due: string }[];
  /** Follow-ups "Add to-dos" would create: forms this school needs that aren't done and aren't on the list yet. */
  todos: AidTodo[];
};

export type AidPlan = {
  schools: AidRow[];
  totals: { cssSchools: number; idocSchools: number; scholarshipsWon: number; wonAmount: number };
};

// Same order and words as public/hub/deadline-plan.js (tests/aid-plan.test.cjs keeps them in step).
const AID_KIND = /financial aid|fafsa|css profile|\bcss\b|\baid\b/i;
const SCHOLARSHIP_KIND = /scholarship|merit|fellow/i;
export function deadlineKind(plan: string): "aid" | "scholarship" | null {
  if (AID_KIND.test(plan)) return "aid";
  if (SCHOLARSHIP_KIND.test(plan)) return "scholarship";
  return null;
}

const NOT_REQUIRED = /^(not required|not used|not applicable|n\/a)\b|css profile (is )?not (used|required|accepted)|css profile[^.;]*\(not required\)/i;
const UNSURE = /^not (listed|mentioned)\b/i;
const REQUIRED = /^required\b|^css profile\b|css profile[^.;]*\brequired\b|\brequired\b[^.;]*css profile/i;

/** Reads a research fact's wording. Anything unclear is "unknown": the student should check the school's aid page. */
export function classifyCss(text: string): CssNeed {
  const t = String(text || "").trim();
  if (!t || UNSURE.test(t)) return "unknown";
  if (NOT_REQUIRED.test(t)) return "not_required";
  if (REQUIRED.test(t)) return "required";
  return "unknown";
}

/** IDOC named as something the school uses ("no IDOC" and "IDOC not used" don't count). */
export const mentionsIdoc = (text: string): boolean => {
  const t = String(text || "");
  return /\bidoc\b/i.test(t) && !/\b(no|without|not)\s+(the\s+)?idoc\b|\bidoc\s+(is\s+)?not\b/i.test(t);
};

const AID_FOLLOW_UP = /\b(fafsa|css|idoc|financial aid|aid|tax|scholarship|w-?2|1040|noncustodial)\b/i;
const DONE_FORM = new Set(["submitted", "processed"]);
const STOPPED_STAGES = new Set(["denied", "closed"]);

/** Reads "$5,000", "5000" or "$12.5k" as dollars; anything else ("TBD", "full tuition") counts as 0. */
export function dollars(amount: string | undefined): number {
  const m = String(amount ?? "").replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*(k)?\b/i);
  if (!m) return 0;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function collegeFor(ws: Workspace, app: TrackedApp): College | undefined {
  const name = app.name.toLowerCase();
  return ws.colleges.find((c) => (app.slug && c.slug === app.slug) || c.name.toLowerCase() === name);
}

function factOf(facts: ResearchFact[], key: ResearchFact["key"]): ResearchFact | undefined {
  return facts.find((f) => f.key === key);
}

function aidDeadlines(college: College | undefined, research: { deadlines?: { plan: string; date: string }[] } | null): AidDeadline[] {
  const seen = new Set<string>();
  const out: AidDeadline[] = [];
  for (const d of [...(college?.deadlines ?? []), ...(research?.deadlines ?? [])]) {
    const kind = deadlineKind(d.plan || "");
    const key = `${d.plan}|${d.date}`;
    if (!kind || !/^\d{4}-\d{2}-\d{2}$/.test(d.date || "") || seen.has(key)) continue;
    seen.add(key);
    out.push({ plan: d.plan, date: d.date, kind });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The aid deadline a to-do is due on: the next one for the student's round when one names it, else the next one. */
function dueFor(deadlines: AidDeadline[], round: string, today: string): string {
  const next = deadlines.filter((d) => d.kind === "aid" && d.date >= today);
  // The portal can report any round text, so it is matched as a plain word, never as a pattern.
  const token = /^[A-Za-z0-9]{1,12}$/.test(round) ? round.toUpperCase() : "";
  const forRound = token ? next.filter((d) => d.plan.toUpperCase().split(/[^A-Z0-9]+/).includes(token)) : [];
  return (forRound[0] ?? next[0])?.date ?? "";
}

function rowFor(ws: Workspace, app: TrackedApp, today: string): AidRow {
  const college = collegeFor(ws, app);
  const research = college?.research ?? loadSchoolResearch(app.slug || app.name) ?? loadSchoolResearch(app.name);
  const facts = research?.facts ?? [];
  const cssFact = factOf(facts, "css_profile");
  const css = classifyCss(cssFact?.value ?? "");
  const idoc = mentionsIdoc(cssFact?.value ?? "");
  const ignoreAid = !!app.ignoreAid;
  const deadlines = ignoreAid ? [] : aidDeadlines(college, research);
  const open = (app.followUps ?? []).filter((f) => !f.done && AID_FOLLOW_UP.test(f.text));
  const known = new Set((app.followUps ?? []).map((f) => f.text.trim().toLowerCase()));
  const due = dueFor(deadlines, effectiveRound(app), today);
  const wanted: AidTodo[] = ignoreAid ? [] : [
    ...(css === "required" && !DONE_FORM.has(ws.financialAid.cssStatus) ? [{ text: `Submit the CSS Profile for ${app.name}`, due }] : []),
    ...(idoc && !DONE_FORM.has(ws.financialAid.idocStatus ?? "n_a") ? [{ text: `Upload tax documents to IDOC for ${app.name}`, due }] : []),
  ];
  const meetsFullNeed = factOf(facts, "meets_full_need")?.value;
  const meritAid = factOf(facts, "merit_aid")?.value;
  return {
    appId: app.id,
    name: app.name,
    slug: college?.slug ?? app.slug ?? null,
    ignoreAid,
    css,
    idoc,
    cssNote: cssFact?.value ?? "",
    cssSource: cssFact?.sourceUrl ?? "",
    cssCheckedAt: cssFact?.checkedAt ?? "",
    ...(meetsFullNeed ? { meetsFullNeed } : {}),
    ...(meritAid ? { meritAid } : {}),
    deadlines,
    followUps: open.map(({ id, text, due: d }) => ({ id, text, due: d })),
    todos: wanted.filter((t) => !known.has(t.text.toLowerCase())),
  };
}

export function aidPlan(ws: Workspace, today = todayIso()): AidPlan {
  const schools = ws.tracker.apps
    .filter((a) => !STOPPED_STAGES.has(statusInfo(a.status).stage))
    .map((a) => rowFor(ws, a, today));
  const won = (ws.scholarships ?? []).filter((s) => s.status === "won");
  return {
    schools,
    totals: {
      cssSchools: schools.filter((s) => !s.ignoreAid && s.css === "required").length,
      idocSchools: schools.filter((s) => !s.ignoreAid && s.idoc).length,
      scholarshipsWon: won.length,
      wonAmount: won.reduce((sum, s) => sum + dollars(s.amount), 0),
    },
  };
}

/** What a parent or counselor sees: which forms each school needs and when. No amounts, offers or notes. */
export function sharedAidPlan(ws: Workspace, today = todayIso()) {
  return aidPlan(ws, today).schools.map(({ appId, name, ignoreAid, css, idoc, cssSource, deadlines, followUps }) => ({
    appId, name, ignoreAid, css, idoc, cssSource, deadlines, followUps,
  }));
}
