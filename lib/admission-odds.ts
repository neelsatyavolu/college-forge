/**
 * Admission chances. A language model asked for "your odds" makes up a number, so every estimate here
 * starts from a published admission rate (the student's round when the school publishes one, else the
 * overall rate), nudged by where the SAT falls in the school's middle 50%. The AI's researched estimate
 * may move it, but only within EST_FACTOR of that starting point, and never past MAX_PERCENT.
 */

import type { College, Workspace } from "./store";
import { decisionOf, effectiveRound, findApp, statusInfo, type TrackedApp } from "./tracker";

export type OddsFactor = { label: string; effect: "up" | "down" | "neutral"; detail: string };

export type AdmissionOdds = {
  /** The estimate, a whole percent. */
  percent: number;
  low: number;
  high: number;
  /** The published-rate starting point the estimate was held to. */
  baseline: number;
  baselineSource: string;
  summary: string;
  factors: OddsFactor[];
  /** https links the research used. */
  sources: string[];
  /** ISO timestamp. */
  estimatedAt: string;
};

/** What the AI took from the student's whole application, read once per estimate run. */
export type ApplicationRead = {
  summary: string;
  academics: string;
  activities: string;
  essays: string;
  context: string;
  strengths: string[];
  concerns: string[];
  /** ISO timestamp. */
  readAt: string;
};

export type Baseline = { percent: number; rate: number; source: string };

/** One school to estimate: a shortlist college (key = slug) or a tracked application not on the shortlist (key = "app:<id>"). */
export type OddsTarget = { key: string; college: College; app?: TrackedApp };

/** Shortlist schools, then tracked applications that aren't on the shortlist, with Scorecard numbers when saved. */
export function oddsTargets(ws: Workspace): OddsTarget[] {
  const shortlist: OddsTarget[] = ws.colleges.filter((c) => c.slug).map((c) => ({ key: c.slug, college: c, app: trackedFor(ws, c) }));
  const covered = new Set(shortlist.map((t) => t.app?.id).filter(Boolean));
  const tracked: OddsTarget[] = (ws.tracker?.apps || []).filter((a) => !covered.has(a.id)).map((app) => {
    const stats = ws.schoolStats?.[app.id];
    return {
      key: `app:${app.id}`,
      app,
      college: { slug: `app-${app.id}`, name: app.name, short: app.name, deadline: effectiveRound(app), admit: stats?.admit, satRange: stats?.satRange },
    };
  });
  return [...shortlist, ...tracked];
}

export const EST_FACTOR = 3;
export const MAX_PERCENT = 95;
export const MIN_PERCENT = 1;

const SAT_EFFECT = { strong: 1.25, close: 1, reach: 0.6 } as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const whole = (n: number) => Math.round(n);

export function parsePercent(text: unknown): number | null {
  const m = String(text ?? "").match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 100 ? n : null;
}

/** "ED I", "Early Decision II", "SCEA", "Regular" → ED / ED2 / EA / EA2 / REA / RD; "" when unknown. */
export function roundKey(label: unknown): string {
  const s = String(label ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/\b(REA|SCEA)\b|RESTRICTIVE|SINGLE CHOICE/.test(s)) return "REA";
  const second = /^(ED|EA|EARLY DECISION|EARLY ACTION) ?(II|2)\b/.test(s) || /^(ED|EA)(II|2)\b/.test(s);
  if (/^ED|EARLY DECISION/.test(s)) return second ? "ED2" : "ED";
  if (/^EA|EARLY ACTION/.test(s)) return second ? "EA2" : "EA";
  if (/^RD\b|REGULAR/.test(s)) return "RD";
  return "";
}

function satTone(college: College, ws: Workspace): keyof typeof SAT_EFFECT | null {
  const sat = Number(String(ws.applicant?.sat ?? "").replace(/[^\d]/g, ""));
  const band = String(college.satRange ?? "").match(/(\d+)\D+(\d+)/);
  const note = ws.applicant?.satNote || ws.profile?.testing?.satNote || "";
  // UC campuses are test-blind; a student not sending scores gets no test adjustment.
  if (!sat || sat < 400 || sat > 1600 || !band || college.slug?.startsWith("university-of-california-")) return null;
  if (/test[- ]optional|not (?:submitting|reporting)/i.test(note)) return null;
  return sat >= Number(band[2]) ? "strong" : sat >= Number(band[1]) ? "close" : "reach";
}

/** The tracked application for a shortlisted school, matched by slug, then by name. */
export function trackedFor(ws: Workspace, college: College): TrackedApp | undefined {
  const tracker = ws.tracker;
  if (!tracker?.apps?.length) return undefined;
  return (college.slug ? findApp(tracker, college.slug) : undefined) ?? findApp(tracker, college.name || "");
}

/** The round the student is applying in: the tracker's (or its portal's), else the shortlist's chosen deadline. */
export function chosenRound(college: College, ws: Workspace, tracked?: TrackedApp): string {
  const app = tracked ?? trackedFor(ws, college);
  return roundKey(app ? effectiveRound(app) : "") || roundKey(college.deadline);
}

/**
 * The published starting point. `publishedRate` is a rate the AI found and cited this run (a newer
 * Common Data Set, say); it replaces the saved one.
 */
export function baselineFor(college: College, ws: Workspace, published?: { rate: number; label: string }, app?: TrackedApp): Baseline | null {
  const round = chosenRound(college, ws, app);
  const planRate = round ? (college.plans || []).find((p) => roundKey(p.plan) === round) : undefined;
  const planPct = planRate ? parsePercent(planRate.rate) : null;
  const overall = parsePercent(college.admit);
  const saved = planPct ?? overall;
  // A researched rate replaces the saved one only when it is plausibly the same kind of number.
  if (published && saved !== null && (published.rate > saved * EST_FACTOR || published.rate < saved / EST_FACTOR)) return null;
  const rate = published ? published.rate : saved;
  if (rate === null || !(rate > 0 && rate <= 100)) return null;
  const label = published ? published.label : planPct !== null ? `${round} admission rate` : "Overall admission rate";
  const tone = satTone(college, ws);
  const percent = clamp(whole(rate * (tone ? SAT_EFFECT[tone] : 1)), MIN_PERCENT, MAX_PERCENT);
  const testNote = tone === "strong" ? ", SAT above the middle 50%" : tone === "reach" ? ", SAT below the middle 50%" : tone === "close" ? ", SAT inside the middle 50%" : "";
  return { percent, rate, source: `${label} ${rate}%${testNote}` };
}

/** How far the AI may move from the baseline. */
export function boundsFor(baseline: number): { min: number; max: number } {
  return {
    min: clamp(Math.ceil(baseline / EST_FACTOR), MIN_PERCENT, MAX_PERCENT),
    max: clamp(whole(Math.min(baseline * EST_FACTOR, baseline + 40)), MIN_PERCENT, MAX_PERCENT),
  };
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function httpsUrls(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const s of v) {
    try {
      const u = new URL(String(s));
      if (u.protocol === "https:") out.add(u.toString());
    } catch { /* not a URL */ }
  }
  return [...out].slice(0, 8);
}

function factors(v: unknown): OddsFactor[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((f) => {
    const o = (f ?? {}) as Record<string, unknown>;
    const label = text(o.label, 80);
    const effect = o.effect === "up" || o.effect === "down" ? o.effect : "neutral";
    return label ? [{ label, effect, detail: text(o.detail, 300) } as OddsFactor] : [];
  }).slice(0, 8);
}

export type OddsResult = { ok: true; odds: AdmissionOdds; note: string } | { ok: false; error: string };

/** Turns the AI's set_admission_odds arguments into a saved estimate held to the published rate. */
export function oddsFromArgs(college: College, ws: Workspace, a: Record<string, unknown>, now: string, app?: TrackedApp): OddsResult {
  const sources = httpsUrls(a.sources);
  // Strict tool schemas make the model fill every field, so 0 means "none found".
  const publishedRate = typeof a.published_rate === "number" && a.published_rate !== 0 ? a.published_rate : NaN;
  const saved = baselineFor(college, ws, undefined, app);
  let published: { rate: number; label: string } | undefined;
  if (Number.isFinite(publishedRate)) {
    if (!(publishedRate > 0 && publishedRate <= 100)) return { ok: false, error: "published_rate must be a percent between 0 and 100." };
    // Without web search the AI tends to echo the saved rate back, or pass one it can't source: keep the saved rate then.
    const echoed = saved != null && Math.abs(publishedRate - saved.rate) < 0.6;
    if (!echoed && sources.length) published = { rate: publishedRate, label: text(a.published_rate_label, 80) || "Published admission rate" };
    else if (!echoed && !saved) return { ok: false, error: "published_rate needs the https page it came from in sources." };
  }
  const base = published ? baselineFor(college, ws, published, app) : saved;
  if (!base && published) {
    return { ok: false, error: `published_rate ${published.rate}% is too far from the saved rate for ${college.name}; check that it is an admission rate for this round.` };
  }
  if (!base) {
    return { ok: false, error: `No admission rate is saved for ${college.name}. Look up its published rate and pass published_rate with its source.` };
  }
  const proposed = typeof a.percent === "number" && Number.isFinite(a.percent) ? a.percent : NaN;
  if (Number.isNaN(proposed)) return { ok: false, error: "percent must be a number." };
  const { min, max } = boundsFor(base.percent);
  const percent = clamp(whole(proposed), min, max);
  const lowIn = typeof a.low === "number" ? a.low : percent;
  const highIn = typeof a.high === "number" ? a.high : percent;
  const low = clamp(whole(Math.min(lowIn, percent)), MIN_PERCENT, percent);
  const high = clamp(whole(Math.max(highIn, percent)), percent, MAX_PERCENT);
  const summary = text(a.summary, 500);
  if (!summary) return { ok: false, error: "summary is required: one or two sentences on why." };
  const note = percent !== whole(proposed)
    ? ` Held to ${percent}% (from ${whole(proposed)}%): estimates stay between ${min}% and ${max}% of a ${base.percent}% published starting point.`
    : "";
  return {
    ok: true,
    note,
    odds: {
      percent, low, high,
      baseline: base.percent,
      baselineSource: base.source,
      summary,
      factors: factors(a.factors),
      sources,
      estimatedAt: now,
    },
  };
}

export function readFromArgs(a: Record<string, unknown>, now: string): ApplicationRead | null {
  const list = (v: unknown) => (Array.isArray(v) ? v.map((s) => text(s, 200)).filter(Boolean).slice(0, 6) : []);
  const read: ApplicationRead = {
    summary: text(a.summary, 700),
    academics: text(a.academics, 500),
    activities: text(a.activities, 500),
    essays: text(a.essays, 700),
    context: text(a.context, 400),
    strengths: list(a.strengths),
    concerns: list(a.concerns),
    readAt: now,
  };
  return read.summary ? read : null;
}

export type DecidedApp = { name: string; slug?: string; round: string; outcome: string };

/** Decisions the student has recorded or opened. Unopened portal decisions stay hidden. */
export function knownDecisions(ws: Workspace): DecidedApp[] {
  return (ws.tracker?.apps || []).flatMap((app) => {
    const d = decisionOf(app);
    if (d.state === "recorded") return [{ name: app.name, slug: app.slug, round: app.round, outcome: statusInfo(app.status).label }];
    if (d.state === "revealed" && d.portalText) return [{ name: app.name, slug: app.slug, round: app.round, outcome: d.portalText.slice(0, 80) }];
    return [];
  });
}
