import rankings from "../public/data/rankings/top250.json";
import schoolMajors from "../public/data/rankings/majors/bachelors_by_school.json";
import type { College, Workspace } from "./store";
import { US_NEWS_BY_SCORECARD_ID, type UsNewsCollege } from "./us-news-rankings";
import { slugify, isTestOptionalNote } from "./colleges";

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

/** A cautious planning signal, never a calibrated admission prediction. */
export function assessAcademicFit(school: UsNewsCollege | undefined, ws: Workspace): AcademicFit {
  const cautions = ["Planning category, not an admission probability. Major, residency, course rigor and application context can change selectivity."];
  const gpa = numeric(ws.applicant.gpaUnweighted, 0, 4);
  const testBlind = school?.slug.startsWith("university-of-california-");
  const testOptional = isTestOptionalNote(ws.applicant.satNote) || isTestOptionalNote(ws.profile.testing.satNote);
  const sat = testBlind || testOptional ? null : numeric(ws.applicant.sat, 400, 1600) ?? numeric(ws.profile.testing.sat, 400, 1600);
  if (testOptional) cautions.push("You marked testing as optional/not submitted, so stored SAT scores are ignored. Verify whether each college permits applying without scores.");
  if (testBlind) cautions.push("UC does not consider SAT/ACT scores in admission; scores are ignored here.");
  if (!school || (gpa === null && sat === null) || school.admitRate === null) {
    return { tier: null, label: "Research", reasons: [!school || school.admitRate === null ? "Comparable admissions data is not in this snapshot." : "Add an unweighted GPA or usable test score for an academic comparison."], cautions };
  }
  const reasons = [`${Math.round(school.admitRate * 1000) / 10}% overall admission rate in the stored snapshot; this is not your personal chance.`];
  let tier: NonNullable<College["tier"]> = school.admitRate < 0.2 ? "reach" : "target";
  const comparableGpa = school.gpa !== null && !school.gpaWeighted ? school.gpa : null;
  if (school.admitRate >= 0.2 && !(gpa !== null && comparableGpa !== null) &&
      !(sat !== null && school.sat25 !== null && school.sat75 !== null)) {
    return { tier: null, label: "Research", reasons: [...reasons, "No comparable GPA or usable SAT range is available for this profile and college."], cautions };
  }
  if (sat !== null && school.sat25 !== null && school.sat75 !== null) {
    reasons.push(`Your SAT ${sat} compared with the reported ${school.sat25}–${school.sat75} middle 50%.`);
    if (sat < school.sat25) tier = "reach";
  }
  if (gpa !== null && comparableGpa !== null) {
    reasons.push(`Your unweighted GPA ${gpa} compared with the reported unweighted average ${comparableGpa}.`);
    if (gpa < comparableGpa - 0.3) tier = "reach";
  }
  const aboveAcademicSignal = gpa !== null && gpa >= 3.5 && (
    (comparableGpa !== null && gpa >= comparableGpa + 0.15) ||
    (sat !== null && school.sat75 !== null && sat >= school.sat75)
  );
  if (tier !== "reach" && school.admitRate >= 0.65 && aboveAcademicSignal &&
      !(sat !== null && school.sat25 !== null && sat < school.sat25)) tier = "safety";
  if (tier === "safety") cautions.push("Likely is provisional: confirm program access and affordability before treating this as a safer option.");
  return { tier, label: tier === "safety" ? "Likely" : tier === "target" ? "Target" : "Reach", reasons, cautions };
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

export function recommendColleges(ws: Workspace) {
  const prefs = ws.onboarding.listPrefs;
  const codes = majorCodes(ws.profile.intended);
  const regions = (prefs?.regions || []).filter(r => r !== "any");
  const settings = (prefs?.settings || []).filter(s => s !== "any").map(s => s === "college-town" ? "town" : s);
  const profileGaps: string[] = [];
  if (numeric(ws.applicant.gpaUnweighted, 0, 4) === null) profileGaps.push("Add an unweighted GPA on a 4.0 scale. Weighted GPA is not converted or compared across scales.");
  if (!codes.size) profileGaps.push("Choose a more specific intended major to compare published major outcomes.");
  if (prefs?.size && prefs.size !== "any") profileGaps.push("Enrollment size is not available in this ranking snapshot; confirm your size preference on the college website.");
  if (prefs?.notes?.trim()) profileGaps.push("Free-text preferences need an advisor review; the automatic list uses the structured region and setting choices.");
  const studentGpa = numeric(ws.applicant.gpaUnweighted, 0, 4);
  const candidates = rankings.schools.flatMap(row => {
    const admissions = US_NEWS_BY_SCORECARD_ID.get(row.unitid);
    // Keep ultra-selective options out of automatic mid-profile lists. Saved choices remain untouched.
    if (studentGpa !== null && studentGpa < 3.7 && admissions?.admitRate != null && admissions.admitRate < 0.1) return [];
    if (regions.length && !regions.some(r => REGIONS[r]?.includes(row.state))) return [];
    if (settings.length && (!admissions || !settings.includes(admissions.setting))) return [];
    const major = matchingMajor(row.unitid, codes);
    const fit = assessAcademicFit(admissions, ws);
    if (regions.length) fit.reasons.unshift(`Matches your preferred region: ${row.state}.`);
    if (settings.length) fit.reasons.unshift(`Matches your ${admissions!.setting} campus preference.`);
    if (major) fit.reasons.unshift(`#${major.rank} of ${major.of} colleges for ${major.name} graduates' earnings versus the same major nationally.`);
    else if (codes.size) fit.cautions.push("No published earnings for a matching major at this college. This does not mean the program is absent or weak; verify its curriculum.");
    if (row.rpp_source === "modeled") fit.cautions.push("Graduate cost of living is modeled for this institution.");
    const college: College = {
      slug: admissions?.slug || slugify(row.institution), name: row.institution, short: row.institution,
      scorecardId: row.unitid, location: `${row.city}, ${row.state}`, setting: admissions?.setting,
      photo: admissions?.photo, tier: fit.tier ?? undefined,
      verdict: { label: fit.label, tone: fit.tier === "reach" ? "caution" : "good" },
      admit: admissions?.admitRate != null ? `${Math.round(admissions.admitRate * 1000) / 10}%` : undefined,
      satRange: admissions?.sat25 != null && admissions.sat75 != null ? `${admissions.sat25}–${admissions.sat75}` : undefined,
      netPrice: row.net_price != null ? `$${Math.round(row.net_price).toLocaleString("en-US")}` : undefined,
      tags: [{label:"Fair-ranking evidence",tone:"teal"}],
    };
    const adjustedEarnings = row.typical_salary != null && row.rpp_grad != null ? Math.round(row.typical_salary / (row.rpp_grad / 100)) : null;
    const score = row.score * 0.75 + (major ? 25 * (1 - (major.rank - 1) / major.of) : 0);
    return [{ college, fit, score, onList: ws.colleges.some(c => c.scorecardId === row.unitid || c.slug === college.slug), evidence: {
      fairRank: row.rank, rankLow: row.rank_low, rankHigh: row.rank_high,
      careerScore: row.score, adjustedEarnings,
      netPrice: row.net_price, costOfAttendance: row.cost_of_attendance,
      major,
      scorecardUrl: `https://collegescorecard.ed.gov/school/?${row.unitid}`,
    }}];
  }).sort((a,b) => b.score - a.score || a.college.scorecardId! - b.college.scorecardId!);
  const requested = prefs?.appCount;
  const count = typeof requested === "number" && Number.isFinite(requested) ? Math.max(8, Math.min(15, Math.round(requested))) : 12;
  const shares = prefs?.ambition === "ambitious" ? [0.4,0.35] : prefs?.ambition === "conservative" ? [0.15,0.4] : [0.25,0.42];
  const reach = Math.round(count * shares[0]); const target = Math.round(count * shares[1]);
  const selected: typeof candidates = [];
  for (const [tier, n] of [["reach",reach],["target",target],["safety",count-reach-target]] as const) {
    selected.push(...candidates.filter(c => c.fit.tier === tier).slice(0,n));
  }
  // Unknowns and missing categories remain honest; never relabel to fill a quota.
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  const limitations = [
    "Based on the 250 institutions in Forge's published fair-ranking snapshot, not every US college.",
    "Graduate outcomes guide comparisons; they do not measure teaching, wellbeing, personal fit or admission chances.",
    "Earnings cover historical federal-aid cohorts, in 2024 dollars. They are not your predicted salary or causal school effects.",
    "Average net price is a historical aid-recipient average, not your quote. Use each school's net price calculator.",
    "Major evidence covers programs with published federal earnings; a missing row does not establish that a major is unavailable or weak.",
    "The generated date describes the fair-ranking snapshot. Admissions metrics come from the separate stored US News / Scorecard catalog; individual admission-cohort dates are not available here.",
    "Admission categories use limited stored aggregate data; verify current major-specific and residency policies.",
  ];
  if (selected.length < count) limitations.push(`Only ${selected.length} colleges match your structured preferences; preferences were not relaxed.`);
  if (!selected.some(c => c.fit.tier === "safety")) limitations.push("No likely option could be supported by the available evidence. Broaden your search and verify a financially workable safer choice.");
  return {
    generatedAt: rankings.generated,
    methodology: "Within provisional academic categories, sort by 75% of the career-outcomes score (0–100) + up to 25 points for where the intended major ranks among colleges with published earnings. Geographic and campus-setting preferences filter the pool. For profiles below 3.7 unweighted GPA, automatic suggestions exclude schools below 10% overall admission. Ambition changes the category mix, not a school's category.",
    sources: [{label:"Ranking data and sources",url:"/data/rankings/sources.md"},{label:"Methodology limitations",url:"/data/rankings/DISCLOSURE.md"},{label:"US Department of Education College Scorecard",url:"https://collegescorecard.ed.gov/data/"},{label:"UC testing policy",url:"https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-first-year/filling-out-the-application.html"}],
    limitations, profileGaps, recommendations: selected.map(({score: _score,...row}) => row),
  };
}

/** Preserve saved choices while filling gaps in the preliminary list's balance. */
export function seedRecommendedColleges(ws: Workspace): College[] {
  const result = [...ws.colleges];
  const prefs = ws.onboarding.listPrefs;
  const desired = Math.max(8, Math.min(15, Math.round(prefs?.appCount || 12)));
  const suggestions = recommendColleges(ws).recommendations.filter(r => !r.onList);
  const shares = prefs?.ambition === "ambitious" ? [0.4, 0.35] : prefs?.ambition === "conservative" ? [0.15, 0.4] : [0.25, 0.42];
  const reach = Math.round(desired * shares[0]); const target = Math.round(desired * shares[1]);
  const goals = { reach, target, safety: desired - reach - target };
  for (const tier of ["safety", "target", "reach"] as const) {
    const current = result.filter(c => {
      const school = c.scorecardId ? US_NEWS_BY_SCORECARD_ID.get(c.scorecardId) : undefined;
      return (school ? assessAcademicFit(school, ws).tier : c.tier) === tier;
    }).length;
    const needed = Math.max(0, Math.min(goals[tier] - current, desired - result.length));
    result.push(...suggestions.filter(r => r.fit.tier === tier).slice(0, needed).map(r => r.college));
  }
  for (const { college } of suggestions) {
    if (result.length >= desired) break;
    if (!result.some(c => c.slug === college.slug || c.scorecardId === college.scorecardId)) result.push(college);
  }
  return result;
}
