import type { Workspace } from "./store";
import type { TrackedApp } from "./tracker";
import { logoUrl } from "./catalog";
import { buildRankListView } from "./rank-list-view";
import { createRanker, majorKeysOf, matchSchoolId, PILLAR_LABELS, PILLARS, SWITCH_LABELS, DEFAULT_WEIGHTS, type CareerData, type CareerSchool, type RankedRow } from "./career-ranking";
import { CAREER_DEFAULT_FLAGS, pathRanks, readCareerSettings, resolveTargets } from "./career-settings";
import { expandAlias } from "./college-aliases";
import { outOfStatePublic, studentFacts } from "./list-facts";
import { schoolPlace } from "./college-recommendations";
import { boardApps, boardFingerprint, schoolAwards, standingOf, type Standing } from "./decision-board-inputs";
import { readSavedPicks, type DecisionPicks } from "./decision-picks";

/**
 * The Decision board: every school that admitted the student (waitlisted and deferred ones marked), side by
 * side with what the rankings say, what a year would cost, and the student's own notes. No AI and no I/O
 * beyond Forge's bundled research files. Weights stay the ranking's own; cost is shown but never ranked.
 */

/** A career pillar this far above or below the average counts as an advantage or a disadvantage. */
export const PILLAR_EDGE = 0.5;
const MAX_TARGETS_SHOWN = 4;

export type BoardCost = { amount: number; basis: "offer" | "income" | "sticker" | "average"; label: string };
export type BoardSwitch = { major: string; level: string; label: string };

export type BoardSchool = {
  id: string;
  name: string;
  logo: string | null;
  standing: Standing;
  /** Picks only come from admitted and committed schools. */
  pickable: boolean;
  position: number | null;
  average: number | null;
  rankSummary: string;
  /** False when the career ranking doesn't cover this school: no pillars or switching rules, not a weakness. */
  careerCovered: boolean;
  pros: string[];
  cons: string[];
  switch: BoardSwitch[];
  cost: BoardCost | null;
  costNote: string;
  aidOffer: TrackedApp["aidOffer"] | null;
  awards: { name: string; amount: string }[];
  notes: string;
  decisionNote: string;
};

export type DecisionBoardView = {
  schools: BoardSchool[];
  picks: DecisionPicks | null;
  /** The saved picks were made before something they read changed. */
  stale: boolean;
  fingerprint: string;
  /** The majors the board judges by ("Computer science"), switch-to majors first. */
  targets: string[];
};

type CareerInput = CareerData & { schools: CareerSchool[] };

function careerIdOf(ws: Workspace, app: TrackedApp, schools: CareerSchool[]): number | null {
  const c = app.slug ? ws.colleges.find((x) => x.slug === app.slug) : undefined;
  const name = c?.name ?? app.name;
  const sid = c?.scorecardId ?? matchSchoolId(name, schools, expandAlias(name));
  return sid != null && schools.some((s) => s.id === sid) ? sid : null;
}

/** The major the student applied in at this school, when the shortlist names one. */
function appliedMajors(ws: Workspace, app: TrackedApp): string[] {
  const c = app.slug ? ws.colleges.find((x) => x.slug === app.slug) : undefined;
  return majorKeysOf(c?.major);
}

/** The List tab's ranking inputs (lib/rankings-me.ts): every shortlisted and tracked school's major, so the averages match. */
function listInputs(ws: Workspace, schools: CareerSchool[]): { id: number; major: string[] }[] {
  const out = new Map<number, string[]>();
  const add = (sid: number | null | undefined, major: string | undefined) => {
    if (sid == null || !schools.some((s) => s.id === sid)) return;
    out.set(sid, [...new Set([...(out.get(sid) ?? []), ...majorKeysOf(major)])]);
  };
  const bySlug = new Map(ws.colleges.map((c) => [c.slug, c]));
  for (const c of ws.colleges) add(c.scorecardId ?? matchSchoolId(c.name, schools, expandAlias(c.name)), c.major);
  for (const app of ws.tracker.apps) {
    const c = app.slug ? bySlug.get(app.slug) : undefined;
    const name = c?.name ?? app.name;
    add(c?.scorecardId ?? matchSchoolId(name, schools, expandAlias(name)), c?.major);
  }
  return [...out].map(([id, major]) => ({ id, major }));
}

/** Board targets: switch-to majors, then picked career targets, then intended majors, then every major. */
export function boardTargets(data: CareerData, ws: Workspace): string[] {
  const all = data.meta.majors.filter((m) => m.target).map((m) => m.key);
  const switchTo = majorKeysOf(ws.profile.switchTo).filter((k) => all.includes(k));
  if (switchTo.length) return switchTo;
  return resolveTargets(all, readCareerSettings(ws.careerSettings)?.targets, majorKeysOf(ws.profile.intended));
}

function switchRows(data: CareerData, s: CareerSchool, targets: string[], direct: string[]): BoardSwitch[] {
  const label = (k: string) => data.meta.majors.find((m) => m.key === k)?.label ?? k;
  return targets.slice(0, MAX_TARGETS_SHOWN).map((k) => {
    const v = s.switch.lv[k];
    if (v === 0) return { major: label(k), level: "0", label: "not offered" };
    if (direct.includes(k)) return { major: label(k), level: "direct", label: "applied directly" };
    if (v == null) return { major: label(k), level: "unchecked", label: SWITCH_LABELS.unchecked };
    return { major: label(k), level: String(v), label: SWITCH_LABELS[String(v)] ?? SWITCH_LABELS.unchecked };
  });
}

function pillarNotes(row: RankedRow | undefined): { pros: string[]; cons: string[] } {
  if (!row) return { pros: [], cons: [] };
  const pros: string[] = [];
  const cons: string[] = [];
  for (const k of PILLARS) {
    const z = row.z[k];
    if (z == null) continue;
    if (z >= PILLAR_EDGE) pros.push(`${PILLAR_LABELS[k][0]}: well above average`);
    else if (z <= -PILLAR_EDGE) cons.push(`${PILLAR_LABELS[k][0]}: below average`);
  }
  if (row.mx.none) cons.push("Doesn't offer the majors you want");
  else if (row.mx.home) cons.push("Your majors are hard to reach here");
  return { pros, cons };
}

/** A year's cost after the offer's grants (loans and work-study are still paid); null without a cost of attendance. */
export function offerNet(offer: TrackedApp["aidOffer"]): number | null {
  if (offer?.costOfAttendance == null) return null;
  return Math.max(0, offer.costOfAttendance - (offer.grants ?? 0));
}

function costOf(ws: Workspace, app: TrackedApp): { cost: BoardCost | null; note: string } {
  const net = offerNet(app.aidOffer);
  if (net != null) {
    return { cost: { amount: net, basis: "offer", label: `$${net.toLocaleString("en-US")} a year after grants, from your aid offer` }, note: "" };
  }
  const facts = studentFacts(ws, app.name, app.slug);
  // A public's published sticker price is the resident one; a nonresident pays far more.
  const residency = (ws.profile.residency || "").trim().toUpperCase();
  if (facts.netPrice?.basis === "sticker" && !facts.international && outOfStatePublic(schoolPlace(app.name, app.slug), residency)) {
    return { cost: null, note: "Out-of-state public: add your aid offer to compare cost." };
  }
  if (facts.netPrice) return { cost: { ...facts.netPrice, label: `${facts.netPrice.label} (estimate, not an offer)` }, note: "" };
  if (facts.outOfState) return { cost: null, note: "Out-of-state public: add your aid offer to compare cost." };
  return { cost: null, note: "No cost data yet. Add your aid offer." };
}

/** Advantages that only exist next to the other offers: best average rank, lowest and highest cost. */
function relativeNotes(schools: BoardSchool[]): BoardSchool[] {
  const ranked = schools.filter((s) => s.pickable && s.average != null);
  const costed = schools.filter((s) => s.pickable && s.cost);
  const best = ranked.length > 1 ? Math.min(...ranked.map((s) => s.average!)) : null;
  const cheap = costed.length > 1 ? Math.min(...costed.map((s) => s.cost!.amount)) : null;
  const dear = costed.length > 1 ? Math.max(...costed.map((s) => s.cost!.amount)) : null;
  return schools.map((s) => {
    if (!s.pickable) return s;
    const pros = [...(best != null && s.average === best ? ["Best average rank of your offers"] : []), ...(cheap != null && cheap !== dear && s.cost?.amount === cheap ? ["Lowest cost of your offers"] : []), ...s.pros];
    const cons = [...(dear != null && cheap !== dear && s.cost?.amount === dear ? ["Highest cost of your offers"] : []), ...s.cons];
    return { ...s, pros, cons };
  });
}

const ORDER: Record<Standing, number> = { committed: 0, admitted: 1, waitlisted: 2, deferred: 3 };

export function decisionBoard(ws: Workspace, careerData: CareerData, officialData: unknown): DecisionBoardView {
  const apps = boardApps(ws);
  const data = careerData as CareerInput;
  const settings = readCareerSettings(ws.careerSettings);
  const fingerprint = boardFingerprint(ws);
  const saved = readSavedPicks(ws.decisionBoard);
  const picks = saved && saved.picks.every((p) => apps.some((a) => a.id === p.appId && standingOf(a) && ORDER[standingOf(a)!] < 2)) ? saved : null;
  if (!apps.length) return { schools: [], picks, stale: !!picks && picks.fingerprint !== fingerprint, fingerprint, targets: [] };

  // The weighted average rank is the List tab's own (its My path rank uses the List's targets, not switch-to majors).
  const ids = new Map(apps.map((a) => [a.id, careerIdOf(ws, a, data.schools)]));
  const me = { intended: majorKeysOf(ws.profile.intended), settings, schools: listInputs(ws, data.schools) };
  const list = buildRankListView(apps, data as unknown as { schools: Record<string, unknown>[] }, officialData, pathRanks(data, me));
  const listRow = new Map(list.rows.map((r) => [r.id, r]));

  const targets = boardTargets(data, ws);
  const direct = Object.fromEntries(apps.flatMap((a) => (ids.get(a.id) != null ? [[ids.get(a.id)!, appliedMajors(ws, a).filter((k) => targets.includes(k))] as const] : [])));
  const flags = settings?.flags ?? CAREER_DEFAULT_FLAGS;
  const rows = createRanker(data).rank({ track: "path", ...flags, w: settings?.weights ?? { ...DEFAULT_WEIGHTS } }, { targets, direct });
  const rowById = new Map(rows.map((r) => [r.s.id, r]));
  // With no majors named anywhere the board ranks on every major; switching rows would then be noise.
  const named = targets.length < data.meta.majors.filter((m) => m.target).length ? targets : [];

  const schools = apps.map((app): BoardSchool => {
    const standing = standingOf(app)!;
    const sid = ids.get(app.id) ?? null;
    const career = sid != null ? rowById.get(sid) : undefined;
    const lr = listRow.get(app.id);
    const { pros, cons } = pillarNotes(career);
    const { cost, note } = costOf(ws, app);
    return {
      id: app.id,
      name: app.name,
      logo: app.collegeId ? (logoUrl(app.collegeId) ?? null) : null,
      standing,
      pickable: ORDER[standing] < 2,
      position: lr?.position ?? null,
      average: lr?.average ?? null,
      rankSummary: lr?.summary ?? "Not ranked",
      careerCovered: !!career && career.s.checked !== false,
      pros,
      cons,
      switch: career ? switchRows(data, career.s, named, direct[sid!] ?? []) : [],
      cost,
      costNote: note,
      aidOffer: app.aidOffer ?? null,
      awards: schoolAwards(ws, app),
      notes: (app.notes || "").slice(0, 1000),
      decisionNote: app.decisionNote || "",
    };
  }).sort((x, y) => ORDER[x.standing] - ORDER[y.standing] || (x.average ?? 1e9) - (y.average ?? 1e9));

  const label = (k: string) => data.meta.majors.find((m) => m.key === k)?.label ?? k;
  return { schools: relativeNotes(schools), picks, stale: !!picks && picks.fingerprint !== fingerprint, fingerprint, targets: named.slice(0, MAX_TARGETS_SHOWN).map(label) };
}
