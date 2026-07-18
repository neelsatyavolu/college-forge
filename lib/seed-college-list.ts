/**
 * Deterministic preliminary college list for onboarding.
 * Must-include schools stay; we fill to ~12 from US News top ~250 using
 * student academics (GPA / SAT) + list prefs. Without GPA matching the pool
 * sorts by rank and dumps Ivies on every student — bad for a 3.4 UW profile.
 *
 * UC campuses share one University of California application (not Common App),
 * so every UC campus counts as a single application slot — you can add many UCs
 * even when the rest of the list is near a ~20-app soft ceiling.
 */

import type { College, OnboardingListPrefs, ListAmbition, Tag } from "./store";
import { US_NEWS_TOP_250, type UsNewsCollege } from "./us-news-rankings";

/** True for University of California campuses (one UC Application covers all). */
export function isUcCampus(c: { slug?: string; name?: string; short?: string }): boolean {
  const slug = (c.slug || "").toLowerCase();
  const name = `${c.name || ""} ${c.short || ""}`.toLowerCase();
  if (slug.startsWith("university-of-california-")) return true;
  if (slug === "ucla" || slug === "ucb" || slug === "ucsd" || slug === "uc-berkeley") return true;
  if (/\buniversity of california\b/.test(name)) return true;
  if (/\buc\s+(berkeley|los angeles|san diego|davis|irvine|santa barbara|santa cruz|riverside|merced)\b/.test(name)) {
    return true;
  }
  if (name.trim() === "ucla") return true;
  return false;
}

/**
 * Soft Common App–style application count: each non-UC school is 1 slot;
 * any number of UC campuses together is 1 slot (one UC Application).
 */
export function applicationSlotCount(
  colleges: { slug?: string; name?: string; short?: string }[]
): number {
  let nonUc = 0;
  let hasUc = false;
  for (const c of colleges) {
    if (isUcCampus(c)) hasUc = true;
    else nonUc++;
  }
  return nonUc + (hasUc ? 1 : 0);
}

const UC_APP_TAG: Tag = { label: "UC Application", tone: "teal" };

function withUcTag(college: College): College {
  if (!isUcCampus(college)) return college;
  const tags = college.tags || [];
  if (tags.some((t) => /uc application/i.test(t.label || ""))) return college;
  return { ...college, tags: [...tags, UC_APP_TAG] };
}

const REGION_STATES: Record<string, Set<string>> = {
  northeast: new Set(["ME", "NH", "VT", "MA", "RI", "CT"]),
  "mid-atlantic": new Set(["NY", "NJ", "PA", "DE", "MD", "DC"]),
  south: new Set([
    "VA", "WV", "KY", "TN", "NC", "SC", "GA", "FL", "AL", "MS", "LA", "AR", "OK", "TX",
  ]),
  midwest: new Set(["OH", "IN", "IL", "MI", "WI", "MN", "IA", "MO", "ND", "SD", "NE", "KS"]),
  west: new Set(["MT", "WY", "CO", "NM", "ID", "UT", "AZ", "NV", "WA", "OR", "CA", "AK", "HI"]),
};

type Tier = "reach" | "target" | "safety";

/**
 * Ambition shapes the mix, not “every reach is Ivy.”
 * Ambitious: more dream reaches (still labeled reach) + solid targets/safeties.
 * Conservative: fewer stretches, more likely admits.
 */
function quota(ambition: ListAmbition): Record<Tier, number> {
  // Ambitious boards are longer: more dream reaches + solid mid + safeties
  if (ambition === "ambitious") return { reach: 10, target: 9, safety: 8 };
  if (ambition === "conservative") return { reach: 2, target: 6, safety: 8 };
  return { reach: 4, target: 7, safety: 5 };
}

/**
 * Soft major affinity — boosts schools known for a field when intended matches.
 * Not exhaustive; used only to rank within tiers. Admit rate still labels tiers.
 */
const MAJOR_SLUG_AFFINITY: { match: RegExp; slugs: string[] }[] = [
  {
    match: /journalis|communicat|media|broadcast|writing|english|news/i,
    slugs: [
      "northwestern-university",
      "new-york-university",
      "university-of-southern-california",
      "university-of-missouri-columbia",
      "university-of-wisconsin-madison",
      "boston-university",
      "university-of-maryland-college-park",
      "indiana-university-bloomington",
      "arizona-state-university",
      "university-of-michigan-ann-arbor",
      "university-of-north-carolina-at-chapel-hill",
      "syracuse-university",
      "university-of-florida",
      "university-of-texas-at-austin",
      "american-university",
      "george-washington-university",
      "university-of-california-berkeley",
      "university-of-california-los-angeles",
      "emory-university",
      "cornell-university",
      "brown-university",
      "washington-university-in-st-louis",
      // solid mid-board often on journalism lists
      "purdue-university-main-campus",
      "wake-forest-university",
      "university-of-pittsburgh",
      "rutgers-university-new-brunswick",
      "the-pennsylvania-state-university-university-park",
      "michigan-state-university",
    ],
  },
  {
    match: /computer|cs\b|software|data sci|ai\b|informat/i,
    slugs: [
      "carnegie-mellon-university",
      "university-of-illinois-urbana-champaign",
      "university-of-washington",
      "georgia-institute-of-technology",
      "university-of-texas-at-austin",
      "university-of-california-berkeley",
      "university-of-california-san-diego",
      "university-of-michigan-ann-arbor",
      "purdue-university-main-campus",
      "university-of-maryland-college-park",
    ],
  },
  {
    match: /business|finance|econ|market|account/i,
    slugs: [
      "university-of-pennsylvania",
      "university-of-michigan-ann-arbor",
      "new-york-university",
      "university-of-california-berkeley",
      "indiana-university-bloomington",
      "university-of-texas-at-austin",
      "university-of-virginia",
      "university-of-north-carolina-at-chapel-hill",
      "boston-college",
      "university-of-southern-california",
    ],
  },
  {
    match: /engineer|mechanical|electrical|civil|aero/i,
    slugs: [
      "massachusetts-institute-of-technology",
      "stanford-university",
      "georgia-institute-of-technology",
      "university-of-illinois-urbana-champaign",
      "purdue-university-main-campus",
      "university-of-michigan-ann-arbor",
      "carnegie-mellon-university",
      "texas-a-m-university",
      "virginia-tech",
      "university-of-california-berkeley",
    ],
  },
];

function majorAffinityBoost(slug: string, intended?: string): number {
  if (!intended || !intended.trim()) return 0;
  let boost = 0;
  for (const row of MAJOR_SLUG_AFFINITY) {
    if (!row.match.test(intended)) continue;
    if (row.slugs.includes(slug)) boost += 28;
  }
  return boost;
}

/** Well-known flagship / solid mid-board schools — preferred for target & safety slots. */
const BACKBONE_SLUGS = new Set([
  "university-of-wisconsin-madison",
  "university-of-illinois-urbana-champaign",
  "university-of-maryland-college-park",
  "purdue-university-main-campus",
  "wake-forest-university",
  "university-of-pittsburgh",
  "rutgers-university-new-brunswick",
  "arizona-state-university",
  "indiana-university-bloomington",
  "the-pennsylvania-state-university-university-park",
  "michigan-state-university",
  "ohio-state-university",
  "university-of-minnesota-twin-cities",
  "university-of-florida",
  "university-of-texas-at-austin",
  "university-of-washington",
  "university-of-georgia",
  "texas-a-m-university",
  "university-of-massachusetts-amherst",
  "clemson-university",
  "university-of-connecticut",
  "virginia-tech",
  "north-carolina-state-university-at-raleigh",
  "university-of-iowa",
  "university-of-colorado-boulder",
]);

function backboneBoost(slug: string, tier: Tier): number {
  if (!BACKBONE_SLUGS.has(slug)) return 0;
  if (tier === "safety") return 22;
  if (tier === "target") return 16;
  return 3;
}

function parseSat(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "" || raw === "—") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n < 400 || n > 1600) return null;
  return Math.round(n);
}

/** Prefer unweighted when both present; 0–4.0 / 0–5.0 scale. */
function parseGpa(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "" || raw === "—") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 6) return null;
  // Weighted 4.3-scale often > 4.0 — normalize roughly for comparisons
  if (n > 4.3) return Math.round(Math.min(4.0, n * 0.93) * 100) / 100;
  return Math.round(n * 100) / 100;
}

function shortName(name: string): string {
  return name.replace(/^The\s+/i, "").replace(/\s*[-–—].*$/, "").slice(0, 28);
}

function settingMatch(schoolSetting: UsNewsCollege["setting"], wanted: string[]): boolean {
  if (!wanted.length) return true;
  const mapped = wanted.map((w) => (w === "college-town" ? "town" : w));
  return mapped.includes(schoolSetting);
}

function regionMatch(state: string, regions: string[]): boolean {
  if (!regions.length || regions.includes("any")) return true;
  const st = state.toUpperCase();
  return regions.some((r) => {
    const set = REGION_STATES[r];
    return set ? set.has(st) : false;
  });
}

function satMid(u: UsNewsCollege): number | null {
  if (typeof u.sat25 === "number" && typeof u.sat75 === "number") {
    return (u.sat25 + u.sat75) / 2;
  }
  return null;
}

/**
 * Academic windows for reach / target / safety.
 * Admit rate & published GPAs are signals — not the whole story.
 * Ambition mainly unlocks more selective *reaches* (still labeled reach).
 *
 * Example ~3.48 UW ambitious journalism-style list:
 *   reaches: Northwestern, Michigan, NYU, USC, Emory, WashU, Cornell…
 *   targets: Wisconsin, Maryland, UIUC, Purdue, Wake Forest, Pitt, Rutgers…
 *   safeties: ASU, IU, Penn State, MSU…
 *   plus a UC cluster (one application).
 */
type SelectivityBand = {
  /** Below this admit rate → usually out of seed pool (except ambitious dream reaches). */
  skipBelow: number;
  /** Below this (and ≥ skipBelow) → reach */
  reachCeil: number;
  /** Below this (and ≥ reachCeil) → target; above → safety */
  targetCeil: number;
  idealAdmit: number;
  idealSchoolGpa: number;
};

function selectivityBand(
  studentGpa: number | null,
  studentSat: number | null,
  ambition: ListAmbition
): SelectivityBand {
  let band: SelectivityBand;
  const g = studentGpa;

  if (g == null && studentSat == null) {
    band = { skipBelow: 0.08, reachCeil: 0.22, targetCeil: 0.5, idealAdmit: 0.35, idealSchoolGpa: 3.6 };
  } else if (g != null && g < 3.2) {
    band = { skipBelow: 0.18, reachCeil: 0.38, targetCeil: 0.68, idealAdmit: 0.52, idealSchoolGpa: 3.3 };
  } else if (g != null && g < 3.45) {
    band = { skipBelow: 0.1, reachCeil: 0.28, targetCeil: 0.58, idealAdmit: 0.42, idealSchoolGpa: 3.45 };
  } else if (g != null && g < 3.65) {
    // ~3.48 UW — targets at flagships; selective privates as reaches when ambitious
    band = { skipBelow: 0.09, reachCeil: 0.26, targetCeil: 0.55, idealAdmit: 0.38, idealSchoolGpa: 3.55 };
  } else if (g != null && g < 3.85) {
    band = { skipBelow: 0.06, reachCeil: 0.18, targetCeil: 0.42, idealAdmit: 0.26, idealSchoolGpa: 3.7 };
  } else if (g != null) {
    band = { skipBelow: 0.04, reachCeil: 0.12, targetCeil: 0.32, idealAdmit: 0.16, idealSchoolGpa: 3.85 };
  } else {
    const s = studentSat!;
    if (s < 1200) band = { skipBelow: 0.16, reachCeil: 0.35, targetCeil: 0.62, idealAdmit: 0.48, idealSchoolGpa: 3.4 };
    else if (s < 1350) band = { skipBelow: 0.1, reachCeil: 0.26, targetCeil: 0.52, idealAdmit: 0.36, idealSchoolGpa: 3.55 };
    else if (s < 1480) band = { skipBelow: 0.06, reachCeil: 0.18, targetCeil: 0.4, idealAdmit: 0.24, idealSchoolGpa: 3.7 };
    else band = { skipBelow: 0.04, reachCeil: 0.12, targetCeil: 0.3, idealAdmit: 0.15, idealSchoolGpa: 3.9 };
  }

  if (ambition === "ambitious") {
    // Open the dream-reach door; do NOT reclassify hyper-selectives as targets
    band = {
      ...band,
      skipBelow: Math.max(0.035, band.skipBelow - 0.055), // e.g. ~0.035–0.05 → Brown/Cornell allowed as reach
      reachCeil: Math.min(0.35, band.reachCeil + 0.04),
      targetCeil: band.targetCeil,
      idealAdmit: Math.max(0.14, band.idealAdmit - 0.03),
    };
  } else if (ambition === "conservative") {
    band = {
      ...band,
      skipBelow: Math.min(0.28, band.skipBelow + 0.05),
      reachCeil: Math.min(0.45, band.reachCeil + 0.06),
      targetCeil: Math.min(0.75, band.targetCeil + 0.06),
      idealAdmit: Math.min(0.65, band.idealAdmit + 0.08),
    };
  }

  if (studentSat != null && g != null) {
    if (studentSat >= 1500 && g >= 3.7) band.skipBelow = Math.max(0.03, band.skipBelow - 0.02);
    if (studentSat < 1150 && g < 3.5) band.skipBelow = Math.min(0.28, band.skipBelow + 0.04);
  }

  return band;
}

/**
 * Tier labels must stay honest: selective schools stay reaches for mid GPAs.
 * GPA ranges & admit rates are signals — major fit / hooks are not modeled as
 * auto-promotions into "target."
 */
function classifyTier(
  u: UsNewsCollege,
  studentSat: number | null,
  studentGpa: number | null,
  ambition: ListAmbition = "balanced"
): Tier {
  const band = selectivityBand(studentGpa, studentSat, ambition);
  const admit = u.admitRate;
  const mid = satMid(u);
  const schoolGpa = typeof u.gpa === "number" ? u.gpa : null;

  // Hyper-selective for this profile → always reach (never "target" for ~3.5 UW)
  if (admit != null && admit < band.skipBelow) return "reach";
  if (admit != null && admit < 0.12 && (studentGpa == null || studentGpa < 3.75)) return "reach";
  if (admit != null && admit < 0.15 && (studentGpa == null || studentGpa < 3.6)) return "reach";

  if (admit != null) {
    if (admit < band.reachCeil) return "reach";
    if (admit < band.targetCeil) {
      if (studentSat != null && mid != null && studentSat < mid - 110) return "reach";
      // Only promote to reach on large GPA gap if admit is still selective
      if (studentGpa != null && schoolGpa != null && schoolGpa - studentGpa > 0.45 && admit < 0.35) {
        return "reach";
      }
      return "target";
    }
    if (studentSat != null && mid != null && studentSat < mid - 130) return "target";
    return "safety";
  }

  if (studentGpa != null && schoolGpa != null) {
    const gap = studentGpa - schoolGpa;
    if (gap <= -0.35) return "reach";
    if (gap >= 0.25) return "safety";
    return "target";
  }
  if (studentSat != null && mid != null) {
    if (studentSat < mid - 90) return "reach";
    if (studentSat > mid + 60) return "safety";
    return "target";
  }
  if (u.rank <= 35) return "reach";
  if (u.rank <= 100) return "target";
  return "safety";
}

/**
 * Lower = better pick for this tier. Blends academic band with major affinity.
 * Admit rate is not everything — strong major programs get a real boost.
 */
function fitScore(
  u: UsNewsCollege,
  studentSat: number | null,
  studentGpa: number | null,
  ambition: ListAmbition = "balanced",
  intended?: string
): number {
  const band = selectivityBand(studentGpa, studentSat, ambition);
  let score = 0;
  const mid = satMid(u);
  const tier = classifyTier(u, studentSat, studentGpa, ambition);

  if (u.admitRate != null) {
    // Ideal admit depends on which tier bucket we're filling
    const ideal =
      tier === "reach"
        ? ambition === "ambitious"
          ? 0.1 // prefer real dream reaches (NU, NYU, USC, Emory…) over mild 20% schools only
          : (band.skipBelow + band.reachCeil) / 2
        : tier === "safety"
          ? Math.min(0.85, band.targetCeil + 0.22)
          : band.idealAdmit;
    score += Math.abs(u.admitRate - ideal) * (tier === "reach" && ambition === "ambitious" ? 40 : 70);
    // Mild penalty for ultra-long-shots on balanced/conservative
    if (tier === "reach" && u.admitRate < 0.06 && ambition !== "ambitious") score += 40;
  } else {
    score += Math.abs(u.rank - (tier === "reach" ? 40 : tier === "safety" ? 120 : 80)) / 12;
  }

  if (studentSat != null && mid != null) {
    // Soft signal only — mid-50s are not hard gates
    score += Math.abs(studentSat - mid) / 14;
  }
  if (studentGpa != null && typeof u.gpa === "number") {
    // Soft signal — published avgs are incomplete / not destiny
    score += Math.abs(studentGpa - u.gpa) * 18;
  }

  // Major affinity (journalism, CS, etc.) — can outweigh mild admit-rate distance
  score -= majorAffinityBoost(u.slug, intended);
  // Prefer recognizable flagships for mid/safety rather than obscure high-admit schools
  score -= backboneBoost(u.slug, tier);

  score += u.rank * 0.01;
  return score;
}

/**
 * Seed-pool filter. Ambitious allows selective dream reaches (Northwestern, Michigan,
 * NYU…) for mid GPAs with strong hooks — still never as fake "targets."
 * Balanced/conservative stay tighter.
 */
function academicallyPlausible(
  u: UsNewsCollege,
  studentSat: number | null,
  studentGpa: number | null,
  ambition: ListAmbition,
  intended?: string
): boolean {
  const band = selectivityBand(studentGpa, studentSat, ambition);
  const admit = u.admitRate;
  const mid = satMid(u);
  const majorHit = majorAffinityBoost(u.slug, intended) > 0;

  if (admit != null && admit < band.skipBelow) {
    // Ambitious + major fit can still keep a few dream schools (e.g. Medill)
    if (!(ambition === "ambitious" && majorHit && admit >= 0.04)) return false;
  }

  if (studentGpa != null) {
    // Hard lottery blocks only for balanced/conservative
    if (ambition !== "ambitious") {
      if (studentGpa < 3.4 && admit != null && admit < 0.12) return false;
      if (studentGpa < 3.55 && admit != null && admit < 0.08) return false;
      if (studentGpa < 3.7 && admit != null && admit < 0.05) return false;
    } else {
      // Ambitious: allow HYP-level only with major affinity or must-include path
      if (studentGpa < 3.55 && admit != null && admit < 0.04) return false;
      if (studentGpa < 3.4 && admit != null && admit < 0.07 && !majorHit) return false;
    }
    // GPA published averages are soft — only extreme gaps drop a school
    if (typeof u.gpa === "number" && u.gpa - studentGpa > 0.65 && ambition === "conservative") {
      return false;
    }
  }

  if (studentSat != null && mid != null) {
    const maxGap = ambition === "ambitious" ? 220 : ambition === "conservative" ? 110 : 160;
    if (mid - studentSat > maxGap && !majorHit) return false;
  }

  return true;
}

function verdictFor(tier: Tier): { tone: string; label: string } {
  if (tier === "reach") return { tone: "top", label: "Reach" };
  if (tier === "safety") return { tone: "good", label: "Safety" };
  return { tone: "good", label: "Target" };
}

export function usNewsToCollege(u: UsNewsCollege, tier: Tier, priority = false): College {
  const admit =
    typeof u.admitRate === "number" ? `${Math.round(u.admitRate * 1000) / 10}%` : undefined;
  const satRange =
    typeof u.sat25 === "number" && typeof u.sat75 === "number"
      ? `${u.sat25}–${u.sat75}`
      : undefined;
  const base: College = {
    slug: u.slug,
    name: u.name,
    short: shortName(u.name),
    location: `${u.city}, ${u.state} · ${u.settingDetail || u.setting}`,
    setting: u.setting,
    rank: u.rank,
    admit,
    satRange,
    gpa: u.gpa != null ? String(u.gpa) : undefined,
    photo: u.photo,
    scorecardId: u.scorecardId,
    tier,
    verdict: verdictFor(tier),
    priority,
  };
  return withUcTag(base);
}

function wantsUcCluster(
  prefs: OnboardingListPrefs,
  location?: string,
  notes?: string,
  existing: College[] = []
): boolean {
  if (existing.some(isUcCampus)) return true;
  const regions = prefs.regions || [];
  if (regions.includes("west") || regions.includes("any") || regions.length === 0) {
    // West / open prefs — UC is a strong free bundle
    if (regions.includes("west")) return true;
  }
  const blob = `${location || ""} ${prefs.notes || ""} ${notes || ""}`.toLowerCase();
  if (/\b(california|ca\b|uc\b|ucla|berkeley|ucsd|davis|irvine)\b/.test(blob)) return true;
  // Default: for CA-state schools in existing list notes, or always lightly for balanced lists in west US
  return false;
}

/**
 * Add academically plausible UC campuses. They share one application slot,
 * so we can attach several without "using up" the rest of the list budget.
 */
function expandUcCampuses(
  list: College[],
  studentSat: number | null,
  studentGpa: number | null,
  ambition: ListAmbition,
  maxUc = 6,
  intended?: string
): College[] {
  const have = new Set(list.map((c) => c.slug));
  const ucAlready = list.filter(isUcCampus).length;
  if (ucAlready >= maxUc) return list.map(withUcTag);

  const ucPool = US_NEWS_TOP_250.filter(
    (u) =>
      isUcCampus(u) &&
      !have.has(u.slug) &&
      academicallyPlausible(u, studentSat, studentGpa, ambition, intended)
  ).sort(
    (a, b) =>
      fitScore(a, studentSat, studentGpa, ambition, intended) -
      fitScore(b, studentSat, studentGpa, ambition, intended)
  );

  const out = list.map(withUcTag);
  let added = ucAlready;
  for (const u of ucPool) {
    if (added >= maxUc) break;
    const tier = classifyTier(u, studentSat, studentGpa, ambition);
    out.push(usNewsToCollege(u, tier, false));
    have.add(u.slug);
    added++;
  }
  return dedupeColleges(out);
}

function slugKey(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Deduplicate by slug and normalized name. */
function dedupeColleges(list: College[]): College[] {
  const bySlug = new Set<string>();
  const byName = new Set<string>();
  const out: College[] = [];
  for (const c of list) {
    const slug = c.slug || slugKey(c.name);
    const nameKey = slugKey(c.name || c.short || "");
    if (bySlug.has(slug) || (nameKey && byName.has(nameKey))) continue;
    bySlug.add(slug);
    if (nameKey) byName.add(nameKey);
    out.push({ ...c, slug });
  }
  return out;
}

export type SeedCollegeListParams = {
  existing: College[];
  prefs: OnboardingListPrefs;
  sat?: string | number | null;
  /** Prefer unweighted when both exist */
  gpaUnweighted?: string | number | null;
  gpaWeighted?: string | number | null;
  intended?: string;
  /** Student location (e.g. "Los Angeles, CA") — used to detect UC interest. */
  location?: string;
  targetCount?: number;
};

export function seedCollegeList(params: SeedCollegeListParams): College[] {
  // Campus count (UCs can push higher — they share 1 app slot).
  // Ambitious lists run longer (closer to a full CA/journalism-style board).
  const ambition: ListAmbition = params.prefs?.ambition || "balanced";
  const defaultTarget = ambition === "ambitious" ? 22 : ambition === "conservative" ? 12 : 15;
  const target = Math.max(8, Math.min(26, params.targetCount ?? defaultTarget));
  const prefs = params.prefs;
  const studentSat = parseSat(params.sat);
  const studentGpa =
    parseGpa(params.gpaUnweighted) ?? parseGpa(params.gpaWeighted);
  const intended = params.intended || "";
  const settings = (prefs.settings || []).filter(Boolean);
  const regions = (prefs.regions || []).filter(Boolean);

  // Dedup existing (must-includes can collide with prior list after redo)
  const kept: College[] = dedupeColleges(params.existing.map((c) => ({ ...c }))).map(withUcTag);
  const have = new Set(kept.map((c) => c.slug));

  // Always re-tier from student stats (must-includes keep the school, not a wrong "target" label)
  for (let i = 0; i < kept.length; i++) {
    const hit = US_NEWS_TOP_250.find((u) => u.slug === kept[i].slug);
    if (hit) {
      const tier = classifyTier(hit, studentSat, studentGpa, ambition);
      kept[i] = withUcTag({
        ...kept[i],
        tier,
        verdict: verdictFor(tier),
        rank: kept[i].rank ?? hit.rank,
        photo: kept[i].photo ?? hit.photo,
        admit:
          kept[i].admit ||
          (hit.admitRate != null ? `${Math.round(hit.admitRate * 1000) / 10}%` : undefined),
        satRange:
          kept[i].satRange ||
          (hit.sat25 != null && hit.sat75 != null ? `${hit.sat25}–${hit.sat75}` : undefined),
        scorecardId: kept[i].scorecardId ?? hit.scorecardId,
      });
    } else {
      // Unknown school: leave mild target unless already labeled
      const tier = (kept[i].tier as Tier) || "target";
      kept[i] = withUcTag({
        ...kept[i],
        tier,
        verdict: verdictFor(tier),
      });
    }
  }

  // Fill non-UC-heavy base list. Prefer non-UC when topping so UC expansion can add campuses free.
  const need = Math.max(0, target - kept.length);
  const q = quota(ambition);
  const filled: Record<Tier, number> = { reach: 0, target: 0, safety: 0 };
  for (const c of kept) {
    const t = (c.tier as Tier) || "target";
    if (t in filled) filled[t]++;
  }

  function pool(opts: {
    strictPrefs: boolean;
    strictAcademics: boolean;
    /** When true, skip UCs so the free UC expansion can add them later. */
    skipUc?: boolean;
  }): UsNewsCollege[] {
    return US_NEWS_TOP_250.filter((u) => {
      if (have.has(u.slug)) return false;
      if (opts.skipUc && isUcCampus(u)) return false;
      if (opts.strictPrefs) {
        if (!settingMatch(u.setting, settings)) return false;
        if (!regionMatch(u.state, regions)) return false;
      }
      if (
        opts.strictAcademics &&
        !academicallyPlausible(u, studentSat, studentGpa, ambition, intended)
      ) {
        return false;
      }
      return true;
    });
  }

  let candidates =
    need > 0
      ? pool({ strictPrefs: true, strictAcademics: true, skipUc: true })
      : [];
  if (need > 0 && candidates.length < need + 12) {
    candidates = pool({ strictPrefs: false, strictAcademics: true, skipUc: true });
  }
  if (need > 0 && candidates.length < need + 8) {
    candidates = pool({ strictPrefs: false, strictAcademics: false, skipUc: true });
  }

  // Prefer major-affinity + backbone schools into the candidate pool
  if (need > 0) {
    const inject = new Set<string>();
    if (intended) {
      for (const row of MAJOR_SLUG_AFFINITY) {
        if (!row.match.test(intended)) continue;
        for (const slug of row.slugs) inject.add(slug);
      }
    }
    for (const slug of BACKBONE_SLUGS) inject.add(slug);
    for (const slug of inject) {
      const u = US_NEWS_TOP_250.find((x) => x.slug === slug);
      if (!u || have.has(u.slug) || isUcCampus(u)) continue;
      if (!academicallyPlausible(u, studentSat, studentGpa, ambition, intended)) continue;
      if (!candidates.some((c) => c.slug === u.slug)) candidates.push(u);
    }
  }

  const byTier: Record<Tier, UsNewsCollege[]> = { reach: [], target: [], safety: [] };
  for (const u of candidates) {
    byTier[classifyTier(u, studentSat, studentGpa, ambition)].push(u);
  }
  for (const t of Object.keys(byTier) as Tier[]) {
    byTier[t].sort((a, b) => {
      // Major-fit schools first within each tier (journalism → Medill/NYU/USC…)
      const ma = majorAffinityBoost(a.slug, intended) > 0 ? 0 : 1;
      const mb = majorAffinityBoost(b.slug, intended) > 0 ? 0 : 1;
      if (ma !== mb) return ma - mb;
      return (
        fitScore(a, studentSat, studentGpa, ambition, intended) -
        fitScore(b, studentSat, studentGpa, ambition, intended)
      );
    });
  }

  const added: College[] = [];
  const take = (tier: Tier, n: number) => {
    while (n > 0 && byTier[tier].length) {
      const u = byTier[tier].shift()!;
      if (have.has(u.slug)) continue;
      have.add(u.slug);
      added.push(usNewsToCollege(u, tier, false));
      filled[tier]++;
      n--;
    }
  };

  if (need > 0) {
    for (const tier of ["reach", "target", "safety"] as Tier[]) {
      take(tier, Math.max(0, q[tier] - filled[tier]));
    }
    let remaining = need - added.length;
    for (const tier of ["target", "safety", "reach"] as Tier[]) {
      if (remaining <= 0) break;
      const before = added.length;
      take(tier, remaining);
      remaining -= added.length - before;
    }
  }

  let result = dedupeColleges([...kept, ...added]);

  // UC Application = one app for all campuses. Expand UCs freely when relevant.
  const maxUc = ambition === "ambitious" ? 9 : 6;
  if (wantsUcCluster(prefs, params.location, prefs.notes, result) || ambition === "ambitious") {
    result = expandUcCampuses(result, studentSat, studentGpa, ambition, maxUc, intended);
  } else if (result.some(isUcCampus)) {
    result = expandUcCampuses(result, studentSat, studentGpa, ambition, 6, intended);
  }

  return result.map(withUcTag);
}
