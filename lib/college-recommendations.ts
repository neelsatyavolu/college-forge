import rankings from "../public/data/rankings/top250.json";
import schoolMajors from "../public/data/rankings/majors/bachelors_by_school.json";
import type { College, Workspace } from "./store";
import { US_NEWS_BY_SCORECARD_ID, type UsNewsCollege } from "./us-news-rankings";
import { slugify, isTestOptionalNote } from "./colleges";
import { actToSat } from "./act-concordance";
import careerData from "../public/data/career-ranking.json";
import { majorKeysOf, SWITCH_LABELS, type CareerData } from "./career-ranking";

const CAREER = careerData as unknown as CareerData;
const CAREER_BY_ID = new Map(CAREER.schools.map((s) => [s.id, s]));
const MAJOR_LABEL = new Map(CAREER.meta.majors.map((m) => [m.key, m.label]));

/**
 * What Forge's career-ranking data says about the intended major at a college: whether it has
 * graduates in any of the matching majors, and how hard it is to switch in (checked by hand for
 * some colleges). Null when the college isn't in that data or the major is unrecognized.
 */
export function majorAccess(unitid: number, intended: string): { offered: boolean; hardSwitch: string | null } | null {
  const school = CAREER_BY_ID.get(unitid);
  const keys = majorKeysOf(intended);
  if (!school || !keys.length || /^(undecided|exploring|not sure)$/i.test(intended.trim())) return null;
  const offered = keys.filter((k) => school.tracks[k]);
  if (!offered.length) return { offered: false, hardSwitch: null };
  const hard = offered.find((k) => (school.switch?.lv?.[k] ?? 0) >= 3);
  return { offered: true, hardSwitch: hard ? `${MAJOR_LABEL.get(hard) ?? hard}: ${SWITCH_LABELS[String(school.switch.lv[hard])]}` : null };
}

export type AcademicFit = {
  tier: College["tier"] | null;
  label: string;
  reasons: string[];
  cautions: string[];
};

const REGIONS: Record<string, string[]> = {
  northeast: ["ME", "NH", "VT", "MA", "RI", "CT"],
  "mid-atlantic": ["NY", "NJ", "PA", "DE", "MD", "DC"],
  south: ["VA", "WV", "KY", "TN", "NC", "SC", "GA", "FL", "AL", "MS", "LA", "AR", "OK", "TX"],
  midwest: ["OH", "IN", "IL", "MI", "WI", "MN", "IA", "MO", "ND", "SD", "NE", "KS"],
  west: ["MT", "WY", "CO", "NM", "ID", "UT", "AZ", "NV", "WA", "OR", "CA", "AK", "HI"],
};

function numeric(raw: string | undefined, min: number, max: number): number | null {
  if (!raw?.trim() || !/^\d+(\.\d+)?$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

export type StudentAcademics = {
  /** Unweighted GPA on a 4.0 scale, or a weighted GPA capped at 4.0 when that is all we have. */
  gpa: number | null;
  gpaFromWeighted: boolean;
  /** SAT total, or the concorded SAT for an ACT composite. Null when test-optional. */
  sat: number | null;
  satFromAct: boolean;
  testOptional: boolean;
  /** The student reported a clear upward grade trend. */
  trendUp: boolean;
  cautions: string[];
};

/** The student's comparable academics, read from both stored score copies. */
export function studentAcademics(ws: Workspace): StudentAcademics {
  const cautions: string[] = [];
  const unweighted = numeric(ws.applicant.gpaUnweighted, 0, 4);
  const weighted = unweighted === null ? numeric(ws.applicant.gpaWeighted, 0, 6) : null;
  // Weighted scales differ by school, so a weighted GPA is never compared with unweighted averages.
  const gpa = unweighted;
  if (unweighted === null && weighted !== null) cautions.push(`Only a weighted GPA (${weighted}) is on file. Weighted scales differ between high schools, so it isn't compared with colleges' unweighted averages; add your unweighted GPA.`);
  const testOptional = isTestOptionalNote(ws.applicant.satNote) || isTestOptionalNote(ws.profile.testing.satNote);
  if (testOptional) cautions.push("You marked testing as optional/not submitted, so stored SAT and ACT scores are ignored. Verify whether each college permits applying without scores.");
  const sat = numeric(ws.profile.testing.sat, 400, 1600) ?? numeric(ws.applicant.sat, 400, 1600);
  // The ACT field is added to the stored profile separately; read it without assuming it exists.
  const act = numeric((ws.profile.testing as { act?: string }).act, 1, 36);
  const concorded = sat === null && act !== null ? actToSat(act) : null;
  if (!testOptional && concorded !== null) cautions.push(`Your ACT ${act} is compared as an SAT ${concorded}, using the published ACT/College Board concordance.`);
  const trendUp = ws.applicant.gpaTrend === "up";
  return {
    gpa, gpaFromWeighted: false, trendUp,
    sat: testOptional ? null : sat ?? concorded, satFromAct: !testOptional && sat === null && concorded !== null,
    testOptional, cautions,
  };
}

// One fixed set of constants for every school, chosen before looking at any list.
const ABOVE_FACTOR = 1.25;
const BELOW_FACTOR = 0.6;
const GPA_ABOVE_MARGIN = 0.15;
const GPA_BELOW_MARGIN = 0.3;
const MAX_ESTIMATE = 0.95;

const isTestBlind = (school: UsNewsCollege) => school.slug.startsWith("university-of-california-");

/** 1.25 at or above the 75th percentile, 1.0 inside the middle 50%, 0.6 below the 25th. */
function satFactor(school: UsNewsCollege, sat: number | null): number | null {
  if (sat === null || isTestBlind(school) || school.sat25 === null || school.sat75 === null) return null;
  return sat >= school.sat75 ? ABOVE_FACTOR : sat >= school.sat25 ? 1 : BELOW_FACTOR;
}

/** Tukey's outlier fence: an SAT more than 1.5 middle-50% widths below the 25th percentile is outside
 * the range of students the college reports admitting, so it is not suggested automatically. */
function farBelowSatRange(school: UsNewsCollege, sat: number | null): boolean {
  if (satFactor(school, sat) === null) return false;
  return sat! < school.sat25! - 1.5 * (school.sat75! - school.sat25!);
}

function comparableGpa(school: UsNewsCollege): number | null {
  return school.gpa !== null && !school.gpaWeighted ? school.gpa : null;
}

function gpaFactor(school: UsNewsCollege, gpa: number | null): number | null {
  const average = comparableGpa(school);
  if (gpa === null || average === null) return null;
  if (gpa >= average + GPA_ABOVE_MARGIN) return ABOVE_FACTOR;
  if (gpa < average - GPA_BELOW_MARGIN) return BELOW_FACTOR;
  return 1;
}

/**
 * Whether a college is in realistic range to suggest automatically. A policy screen, fixed before
 * looking at any list and identical for every college; not a calibrated probability. Colleges that
 * admit under 15% need the student inside the reported middle 50% (SAT at or above the 25th percentile,
 * unweighted GPA within 0.10 of the average); 15-35% allows half a middle-50% width below the 25th
 * percentile and 0.25 below the GPA average. A missing comparison never counts as passing: with
 * neither available, colleges under 35% aren't suggested. An ambitious student with a clear upward
 * grade trend gets 0.10 more room on the GPA test only.
 */
export const GATE = { verySelective: 0.15, selective: 0.35, gpaMarginVery: 0.1, gpaMarginSelective: 0.25, satWidthsSelective: 0.5, trendRelief: 0.1 } as const;

export function realismGate(school: UsNewsCollege, academics: StudentAcademics, ambitious: boolean): { ok: boolean; reason?: string; passedBecauseOfTrend?: boolean } {
  const admit = school.admitRate;
  if (admit === null || admit >= GATE.selective) return { ok: true };
  const very = admit < GATE.verySelective;
  const relief = ambitious && academics.trendUp ? GATE.trendRelief : 0;
  const satComparable = satFactor(school, academics.sat) !== null;
  const avg = comparableGpa(school);
  const gpaComparable = academics.gpa !== null && avg !== null;
  if (!satComparable && !gpaComparable) return { ok: false, reason: "No comparable GPA or test score for a college this selective." };
  if (satComparable) {
    const width = school.sat75! - school.sat25!;
    const floor = very ? school.sat25! : school.sat25! - GATE.satWidthsSelective * width;
    if (academics.sat! < floor) return { ok: false, reason: `SAT ${academics.sat} is below ${floor}.` };
  }
  if (gpaComparable) {
    const strict = avg! - (very ? GATE.gpaMarginVery : GATE.gpaMarginSelective);
    const floor = strict - relief;
    if (academics.gpa! < floor - 1e-9) return { ok: false, reason: `Unweighted GPA ${academics.gpa} is below ${Math.round(floor * 100) / 100}.` };
    if (academics.gpa! < strict - 1e-9) return { ok: true, passedBecauseOfTrend: true };
  }
  return { ok: true };
}

/** 0 when the student is at or above the middle of the college's reported range, 1 otherwise. */
function academicBand(school: UsNewsCollege | undefined, academics: StudentAcademics): 0 | 1 {
  if (!school) return 1;
  if (satFactor(school, academics.sat) !== null) return academics.sat! >= (school.sat25! + school.sat75!) / 2 ? 0 : 1;
  const avg = comparableGpa(school);
  if (academics.gpa !== null && avg !== null) return academics.gpa >= avg ? 0 : 1;
  return 1;
}

/** A rough planning estimate: the published admit rate nudged by the SAT and GPA comparisons. Not a probability. */
export function estimateChance(school: UsNewsCollege, academics: StudentAcademics): number | null {
  if (school.admitRate === null) return null;
  const estimate = school.admitRate * (satFactor(school, academics.sat) ?? 1) * (gpaFactor(school, academics.gpa) ?? 1);
  return Math.min(MAX_ESTIMATE, estimate);
}

function fitWithEstimate(school: UsNewsCollege | undefined, academics: StudentAcademics): { fit: AcademicFit; estimate: number | null } {
  const cautions = ["Planning category, not an admission probability. Major, residency, course rigor and application context can change selectivity.", ...academics.cautions];
  if (school && isTestBlind(school)) cautions.push("UC does not consider SAT/ACT scores in admission; scores are ignored here.");
  if (!school || school.admitRate === null) {
    return { fit: { tier: null, label: "Research", reasons: ["Comparable admissions data is not in this snapshot."], cautions }, estimate: null };
  }
  const estimate = estimateChance(school, academics);
  if (academics.gpa === null && academics.sat === null) {
    return { fit: { tier: null, label: "Research", reasons: ["Add an unweighted GPA or usable test score for an academic comparison."], cautions }, estimate };
  }
  const admit = school.admitRate;
  const reasons = [`${Math.round(admit * 1000) / 10}% overall admission rate in the stored snapshot; this is not your personal chance.`];
  const sat = satFactor(school, academics.sat);
  const gpa = gpaFactor(school, academics.gpa);
  if (sat !== null) reasons.push(`Your ${academics.satFromAct ? "ACT-concorded SAT" : "SAT"} ${academics.sat} compared with the reported ${school.sat25}–${school.sat75} middle 50%.`);
  if (gpa !== null) reasons.push(`Your ${academics.gpaFromWeighted ? "weighted GPA, capped at 4.0," : "unweighted GPA"} ${academics.gpa} compared with the reported unweighted average ${comparableGpa(school)}.`);
  const signal = sat !== null || gpa !== null;
  if (!signal) cautions.push("No comparable GPA or SAT range for this college, so its category uses the admission rate alone.");
  const p = estimate ?? admit;
  const tier: NonNullable<College["tier"]> = p < 0.25 || admit < 0.2 ? "reach"
    : (signal ? p >= 0.6 && admit >= 0.5 : admit >= 0.75) ? "safety" : "target";
  if (tier === "safety") cautions.push("Likely is provisional: confirm program access and affordability before treating this as a safer option.");
  return { fit: { tier, label: tier === "safety" ? "Likely" : tier === "target" ? "Target" : "Reach", reasons, cautions }, estimate };
}

/** A cautious planning signal, never a calibrated admission prediction. */
export function assessAcademicFit(school: UsNewsCollege | undefined, ws: Workspace): AcademicFit {
  return fitWithEstimate(school, studentAcademics(ws)).fit;
}

type MajorEvidence = { code: string; name: string; rank: number; of: number };
const MAJOR_NAMES = schoolMajors.majors as Record<string, string>;
// JSON imports widen tuples to arrays; the exporter writes [cip, rank, n_ranked].
const SCHOOL_MAJOR_RANKS = schoolMajors.ranks as unknown as Record<string, [string, number, number][]>;

function majorCodes(intended: string): Set<string> {
  const query = intended.toLowerCase().trim();
  if (!query || /^(undecided|exploring|not sure)$/.test(query)) return new Set();
  const aliases: [RegExp, string[]][] = [
    [/^(cs|computer science|software engineering)$/i, ["1107", "1101", "1409"]],
    [/^journalism$/i, ["0904"]], [/^business$/i, ["5202"]], [/^biology$/i, ["2601"]],
    [/^psychology$/i, ["4201"]], [/^nursing$/i, ["5138"]], [/^economics$/i, ["4506"]],
    [/^mechanical engineering$/i, ["1419"]], [/^finance$/i, ["5208"]],
  ];
  const alias = aliases.find(([pattern]) => pattern.test(query));
  if (alias) return new Set(alias[1]);
  const words = query.split(/[^a-z]+/).filter(w => w.length > 2);
  if (!words.length) return new Set();
  return new Set(Object.entries(MAJOR_NAMES)
    .filter(([, name]) => words.every(w => name.toLowerCase().includes(w))).map(([cip]) => cip));
}

/** Best-ranked matching bachelor's major at this school in the published per-major tables. */
function matchingMajor(unitid: number, codes: Set<string>): MajorEvidence | null {
  const rows = SCHOOL_MAJOR_RANKS[String(unitid)] ?? [];
  const best = rows.filter(([cip]) => codes.has(cip)).sort((a, b) => a[1] / a[2] - b[1] / b[2])[0];
  if (!best) return null;
  const [code, rank, of] = best;
  return { code, name: MAJOR_NAMES[code], rank, of };
}

type Tier = NonNullable<College["tier"]>;
/** `goal` is the category's quota, so a reader can recount `missing` against the current list. */
export type ListGap = { tier: Tier; missing: number; goal?: number };
type PrefsWithBudget = NonNullable<Workspace["onboarding"]["listPrefs"]> & { budget?: string };

/** Ambition sets the minimum planning estimate a school needs before it is suggested. */
const MIN_ESTIMATE = { ambitious: 0.02, balanced: 0.04, conservative: 0.08 } as const;
const SHARES = { ambitious: [0.4, 0.35], balanced: [0.28, 0.42], conservative: [0.15, 0.4] } as const;
/** Upper bound of each family-budget bucket, in dollars of average net price per year. */
const BUDGET_MAX: Record<string, number> = { lt15: 15000, "15-30": 30000, "30-50": 50000 };
const TIER_WORD: Record<Tier, string> = { reach: "reach", target: "target", safety: "likely" };

function listQuotas(prefs: Workspace["onboarding"]["listPrefs"]) {
  const requested = prefs?.appCount;
  const count = typeof requested === "number" && Number.isFinite(requested) ? Math.max(8, Math.min(15, Math.round(requested))) : 12;
  const [reachShare, targetShare] = SHARES[prefs?.ambition ?? "balanced"] ?? SHARES.balanced;
  const reach = Math.round(count * reachShare); const target = Math.round(count * targetShare);
  return { count, goals: { reach, target, safety: count - reach - target } as Record<Tier, number> };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function recommendColleges(ws: Workspace, options: { excludeOnList?: boolean } = {}) {
  const prefs = ws.onboarding.listPrefs as PrefsWithBudget | undefined;
  const codes = majorCodes(ws.profile.intended);
  const regions = (prefs?.regions || []).filter(r => r !== "any");
  const settings = (prefs?.settings || []).filter(s => s !== "any").map(s => s === "college-town" ? "town" : s);
  const academics = studentAcademics(ws);
  const hasAcademics = academics.gpa !== null || academics.sat !== null;
  const minEstimate = MIN_ESTIMATE[prefs?.ambition ?? "balanced"] ?? MIN_ESTIMATE.balanced;
  const budget = prefs?.budget ? BUDGET_MAX[prefs.budget] ?? null : null;
  const residency = /^[A-Za-z]{2}$/.test(ws.profile.residency?.trim() || "") ? ws.profile.residency.trim().toUpperCase() : null;
  const profileGaps: string[] = [];
  if (numeric(ws.applicant.gpaUnweighted, 0, 4) === null) profileGaps.push(academics.gpaFromWeighted
    ? "Add an unweighted GPA on a 4.0 scale. Until then your weighted GPA is capped at 4.0 for comparisons."
    : "Add an unweighted GPA on a 4.0 scale.");
  if (!codes.size) profileGaps.push("Choose a more specific intended major to compare published major outcomes.");
  if (prefs?.size && prefs.size !== "any") profileGaps.push("Enrollment size is not available in this ranking snapshot; confirm your size preference on the college website.");
  if (prefs?.notes?.trim()) profileGaps.push("Free-text preferences need an advisor review; the automatic list uses the structured region and setting choices.");
  const candidates = rankings.schools.flatMap(row => {
    const admissions = US_NEWS_BY_SCORECARD_ID.get(row.unitid);
    const { fit: base, estimate } = fitWithEstimate(admissions, academics);
    // Too long a shot for this ambition level. Saved choices remain untouched.
    if (hasAcademics && estimate !== null && estimate < minEstimate) return [];
    if (admissions && farBelowSatRange(admissions, academics.sat)) return [];
    const gate = hasAcademics && admissions ? realismGate(admissions, academics, prefs?.ambition === "ambitious") : { ok: true };
    if (!gate.ok) return [];
    // Not suggested when Forge's career data shows no graduates in the student's major there.
    const access = majorAccess(row.unitid, ws.profile.intended || "");
    if (access && !access.offered) return [];
    if (options.excludeOnList && ws.colleges.some(c => c.scorecardId === row.unitid || c.slug === (admissions?.slug || slugify(row.institution)))) return [];
    const overBudget = budget !== null && row.net_price != null && row.net_price > budget;
    if (overBudget && base.tier === "safety") return [];
    const inRegion = !regions.length || regions.some(r => REGIONS[r]?.includes(row.state));
    const inSetting = !settings.length || (!!admissions && settings.includes(admissions.setting));
    const inState = residency !== null && row.state === residency;
    const isPublic = row.control === "public";
    const major = matchingMajor(row.unitid, codes);
    const reasons = [
      ...(major ? [`#${major.rank} of ${major.of} colleges for ${major.name} graduates' earnings versus the same major nationally.`] : []),
      ...(settings.length && inSetting ? [`Matches your ${admissions!.setting} campus preference.`] : []),
      ...(regions.length && inRegion ? [`Matches your preferred region: ${row.state}.`] : []),
      ...(inState && isPublic ? [`In-state public college for a ${residency} resident. Check its in-state tuition and admission rules.`] : []),
      ...base.reasons,
    ];
    const cautions = [
      ...base.cautions,
      ...(!major && codes.size ? ["No published earnings for a matching major at this college. This does not mean the program is absent or weak; verify its curriculum."] : []),
      ...(access?.hardSwitch ? [`Getting into ${access.hardSwitch.split(":")[0]} here is ${access.hardSwitch.split(": ")[1]} for students who don't start in it. Apply to the major directly if the college allows it.`] : []),
      ...(!row.location_observed ? ["Where graduates work (used for cost of living) is modeled for this institution, not observed."] : []),
      ...(overBudget ? [`Average net price ${money(row.net_price!)} is above your budget of ${money(budget!)} a year. Run this college's net price calculator.`] : []),
    ];
    const fit: AcademicFit = { ...base, reasons, cautions };
    const college: College = {
      slug: admissions?.slug || slugify(row.institution), name: row.institution, short: row.institution,
      scorecardId: row.unitid, location: `${row.city}, ${row.state}`, setting: admissions?.setting,
      photo: admissions?.photo, tier: fit.tier ?? undefined,
      verdict: { label: fit.label, tone: fit.tier === "reach" ? "caution" : "good" },
      admit: admissions?.admitRate != null ? `${Math.round(admissions.admitRate * 1000) / 10}%` : undefined,
      satRange: admissions?.sat25 != null && admissions.sat75 != null ? `${admissions.sat25}–${admissions.sat75}` : undefined,
      netPrice: row.net_price != null ? money(row.net_price) : undefined,
      tags: [{label:"Fair-ranking evidence",tone:"teal"}, ...(inState ? [{label:"In-state",tone:"teal"}] : [])],
    };
    const adjustedEarnings = row.typical_earnings != null && row.rpp_grad != null ? Math.round(row.typical_earnings / (row.rpp_grad / 100)) : null;
    const score = row.score_partial * 0.75 + (major ? 25 * (1 - (major.rank - 1) / major.of) : 0);
    // Targets and likely schools where the student sits in the upper half of the range come first.
    const band = base.tier === "reach" ? 0 : academicBand(admissions, academics);
    if (gate.passedBecauseOfTrend) reasons.push(`Suggested because you reported a clear upward grade trend: it relaxed Forge's GPA screen for this college by ${GATE.trendRelief.toFixed(2)}. Your cumulative GPA is still below its typical range.`);
    return [{ college, fit, score, band, matchesPrefs: inRegion && inSetting, inStatePublic: inState && isPublic,
      onList: ws.colleges.some(c => c.scorecardId === row.unitid || c.slug === college.slug), evidence: {
      fairRank: row.rank_partial, rankLow: row.rank_partial_low, rankHigh: row.rank_partial_high,
      careerScore: row.score_partial, adjustedEarnings,
      netPrice: row.net_price, costOfAttendance: row.cost_of_attendance,
      major,
      scorecardUrl: `https://collegescorecard.ed.gov/school/?${row.unitid}`,
    }}];
  }).sort((a,b) => a.band - b.band || b.score - a.score || a.college.scorecardId! - b.college.scorecardId!);
  type Candidate = (typeof candidates)[number];
  const { count, goals } = listQuotas(prefs);
  const preferred = candidates.filter(c => c.matchesPrefs);
  const picks: Record<Tier, Candidate[]> = { reach: [], target: [], safety: [] };
  const gaps: ListGap[] = [];
  let relaxed = 0;
  if (hasAcademics) {
    for (const tier of ["reach", "target", "safety"] as const) {
      const matched = preferred.filter(c => c.fit.tier === tier).slice(0, goals[tier]);
      // A short category is filled only from the same category, looking past region and setting choices.
      const extra = candidates.filter(c => !c.matchesPrefs && c.fit.tier === tier).slice(0, goals[tier] - matched.length)
        .map(c => ({ ...c, fit: { ...c.fit, reasons: [`Outside your region or campus setting choices. Added because too few ${TIER_WORD[tier]} colleges matched them.`, ...c.fit.reasons] } }));
      relaxed += extra.length;
      picks[tier] = [...matched, ...extra];
      if (picks[tier].length < goals[tier]) gaps.push({ tier, missing: goals[tier] - picks[tier].length });
    }
    if (residency && ![...picks.target, ...picks.safety].some(c => c.inStatePublic)) {
      const local = preferred.find(c => c.inStatePublic && (c.fit.tier === "target" || c.fit.tier === "safety"));
      const tier = local?.fit.tier as Tier | undefined;
      if (local && tier && picks[tier].length) picks[tier] = [...picks[tier].slice(0, -1), local];
    }
  }
  // Without a GPA or score there are no categories to balance: show the strongest outcomes evidence.
  const selected = hasAcademics ? [...picks.reach, ...picks.target, ...picks.safety] : preferred.slice(0, count);
  const limitations = [
    "Based on the 250 institutions in Forge's published fair-ranking snapshot, not every US college.",
    "Graduate outcomes guide comparisons; they do not measure teaching, wellbeing, personal fit or admission chances.",
    "Earnings cover historical federal-aid cohorts, in 2024 dollars. They are not your predicted salary or causal school effects.",
    "Average net price is a historical aid-recipient average, not your quote. Use each school's net price calculator.",
    "Major evidence covers programs with published federal earnings; a missing row does not establish that a major is unavailable or weak.",
    "The generated date describes the fair-ranking snapshot. Admissions metrics come from the separate stored US News / Scorecard catalog; individual admission-cohort dates are not available here.",
    "Admission categories use limited stored aggregate data; verify current major-specific and residency policies.",
  ];
  if (relaxed) limitations.push(`${relaxed} ${relaxed === 1 ? "college is" : "colleges are"} outside your region or campus setting choices, added because too few matched them. Each one says so.`);
  for (const gap of gaps) limitations.push(`Short ${gap.missing} ${TIER_WORD[gap.tier]} ${gap.missing === 1 ? "college" : "colleges"}: no more passed the evidence and budget checks. Add your own.`);
  if (!hasAcademics && selected.length < count) limitations.push(`Only ${selected.length} colleges match your structured preferences; preferences were not relaxed.`);
  if (hasAcademics && !selected.some(c => c.fit.tier === "safety")) limitations.push("No likely option could be supported by the available evidence. Broaden your search and verify a financially workable safer choice.");
  return {
    generatedAt: rankings.generated,
    methodology: "Each college gets one planning estimate: its overall admission rate × an SAT factor (1.25 at or above the 75th percentile, 1.0 inside the middle 50%, 0.6 below the 25th) × a GPA factor (1.25 at 0.15 above the reported unweighted average, 0.6 more than 0.3 below it). The same constants apply to every college. Reach: estimate under 25% or admission under 20%. Likely: estimate 60% or more at a college admitting at least 50% (75% when there is nothing to compare). Ambition sets the minimum estimate to be suggested (2%, 4% or 8%) and the category mix. A college is not suggested when your SAT is more than 1.5 middle-50% widths below its 25th percentile (Tukey's outlier fence). Selective colleges also need you in realistic range: under 15% admission, an SAT at or above the 25th percentile and an unweighted GPA within 0.10 of the average; 15–35%, an SAT no more than half a middle-50% width below the 25th percentile and a GPA within 0.25; with neither comparison available they aren't suggested. An ambitious student with a clear upward grade trend gets 0.10 more room on the GPA test. A weighted GPA is never compared with unweighted averages. Colleges that Forge's career data shows with no graduates in your intended major aren't suggested. Within the target and likely categories, colleges where your scores sit in the upper half of the reported range come first. Within each group, sort by 75% of the career-outcomes score with a half cost-of-living adjustment (0–100) + up to 25 points for where the intended major ranks among colleges with published earnings. Region and campus-setting choices filter the pool. A budget removes likely colleges above it and flags the rest. The estimate is not an admission probability.",
    sources: [{label:"Ranking data and sources",url:"/data/rankings/sources.md"},{label:"Methodology limitations",url:"/data/rankings/DISCLOSURE.md"},{label:"US Department of Education College Scorecard",url:"https://collegescorecard.ed.gov/data/"},{label:"UC testing policy",url:"https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-first-year/filling-out-the-application.html"}],
    limitations, profileGaps, gaps,
    recommendations: selected.map(({score: _score, band: _band, matchesPrefs: _matches, inStatePublic: _local, ...row}) => row),
  };
}

/**
 * Preserve saved choices while filling gaps in the preliminary list's balance. A short category is
 * filled only with that category; what cannot be filled comes back in `gaps`. With keepUserSchools,
 * earlier seeded rows are dropped and refilled, keeping priority schools and anything the student or
 * an agent added.
 */
const SEED_TAGS = new Set(["Fair-ranking evidence", "In-state"]);
/**
 * Every field the list builder writes on a row, plus `supp` (derived from the essay prompts) and `priority`
 * (set false on every row when another school is starred). A row with any other field was edited by hand.
 */
const SEED_FIELDS = new Set(["slug", "name", "short", "scorecardId", "location", "setting", "photo", "tier", "verdict", "admit", "satRange", "netPrice", "tags", "supp", "priority"]);

/**
 * Whether the automatic list builder may replace this row. Rows saved before `origin` existed carry no
 * origin; those count as seeded only when they look exactly like a builder row: its tags and its fields.
 */
export function isSeededRow(c: College): boolean {
  if (c.priority) return false;
  if (c.origin) return c.origin === "seed";
  const tags = c.tags || [];
  return tags.some(t => t.label === "Fair-ranking evidence") && tags.every(t => SEED_TAGS.has(t.label))
    && Object.keys(c).every(k => SEED_FIELDS.has(k));
}

export function seedRecommendedColleges(ws: Workspace, options: { keepUserSchools?: boolean } = {}): { colleges: College[]; gaps: ListGap[] } {
  const kept = options.keepUserSchools ? ws.colleges.filter(c => !isSeededRow(c)) : ws.colleges;
  const { count: desired, goals } = listQuotas(ws.onboarding.listPrefs);
  // Saved schools are left out before each category is cut to size, so they never use up its slots.
  const suggestions = recommendColleges({ ...ws, colleges: kept }, { excludeOnList: true }).recommendations;
  const tierOf = (c: College) => {
    const school = c.scorecardId ? US_NEWS_BY_SCORECARD_ID.get(c.scorecardId) : undefined;
    return school ? assessAcademicFit(school, ws).tier : c.tier;
  };
  const result = (["safety", "target", "reach"] as const).reduce<College[]>((list, tier) => {
    const current = list.filter(c => tierOf(c) === tier).length;
    const needed = Math.max(0, Math.min(goals[tier] - current, desired - list.length));
    const added = suggestions.filter(r => r.fit.tier === tier).slice(0, needed)
      .map(r => ({ ...r.college, origin: "seed" as const }));
    return [...list, ...added];
  }, [...kept]);
  const gaps = (["reach", "target", "safety"] as const)
    .map(tier => ({ tier, missing: goals[tier] - result.filter(c => tierOf(c) === tier).length, goal: goals[tier] }))
    .filter(g => g.missing > 0);
  return { colleges: result, gaps };
}

export type Rebalance = { workspace: Workspace; added: string[]; removed: string[]; gaps: ListGap[] };

/** Refills the automatic picks, keeping the student's and agents' schools, and saves the unfilled categories. */
export function rebalanceWorkspace(ws: Workspace): Rebalance {
  const seeded = seedRecommendedColleges(ws, { keepUserSchools: true });
  const before = new Set(ws.colleges.map(c => c.slug));
  const after = new Set(seeded.colleges.map(c => c.slug));
  const name = (c: College) => c.short || c.name;
  return {
    workspace: { ...ws, colleges: seeded.colleges, onboarding: { ...ws.onboarding, listGaps: seeded.gaps } },
    added: seeded.colleges.filter(c => !before.has(c.slug)).map(name),
    removed: ws.colleges.filter(c => !after.has(c.slug)).map(name),
    gaps: seeded.gaps,
  };
}
