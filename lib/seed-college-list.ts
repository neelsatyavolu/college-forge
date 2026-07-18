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
 * Ambition only nudges the mix — it is NOT “load the list with Ivies.”
 * Ambitious ≈ one extra mild reach; conservative ≈ more likely admits.
 */
function quota(ambition: ListAmbition): Record<Tier, number> {
  if (ambition === "ambitious") return { reach: 3, target: 5, safety: 4 };
  if (ambition === "conservative") return { reach: 1, target: 5, safety: 6 };
  return { reach: 2, target: 5, safety: 5 };
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
 * Academic “home band” for this student — admit-rate windows that define
 * realistic reach / target / safety. Ambition only shifts the windows a little.
 *
 * Example ~3.48 UW (no SAT): targets roughly 30–60% admit, reaches 15–30%,
 * safeties 60%+; ultra-selectives (&lt;~12%) are excluded from the seed pool
 * unless must-include (and still labeled reach).
 */
type SelectivityBand = {
  /** Schools with admit rate below this are out of the seed pool (lottery). */
  skipBelow: number;
  /** Below this (and ≥ skipBelow) → reach */
  reachCeil: number;
  /** Below this (and ≥ reachCeil) → target; above → safety */
  targetCeil: number;
  /** Ideal admit rate for ranking targets */
  idealAdmit: number;
  /** Ideal school avg GPA for ranking */
  idealSchoolGpa: number;
};

function selectivityBand(
  studentGpa: number | null,
  studentSat: number | null,
  ambition: ListAmbition
): SelectivityBand {
  // Base band from unweighted-ish GPA
  let band: SelectivityBand;
  const g = studentGpa;

  if (g == null && studentSat == null) {
    band = { skipBelow: 0.1, reachCeil: 0.22, targetCeil: 0.5, idealAdmit: 0.35, idealSchoolGpa: 3.6 };
  } else if (g != null && g < 3.2) {
    band = { skipBelow: 0.22, reachCeil: 0.4, targetCeil: 0.7, idealAdmit: 0.55, idealSchoolGpa: 3.3 };
  } else if (g != null && g < 3.45) {
    band = { skipBelow: 0.15, reachCeil: 0.32, targetCeil: 0.6, idealAdmit: 0.45, idealSchoolGpa: 3.45 };
  } else if (g != null && g < 3.65) {
    // ~3.48–3.64 — solid list, NOT Ivy targets
    band = { skipBelow: 0.12, reachCeil: 0.28, targetCeil: 0.55, idealAdmit: 0.4, idealSchoolGpa: 3.55 };
  } else if (g != null && g < 3.85) {
    band = { skipBelow: 0.08, reachCeil: 0.2, targetCeil: 0.45, idealAdmit: 0.28, idealSchoolGpa: 3.7 };
  } else if (g != null) {
    band = { skipBelow: 0.05, reachCeil: 0.14, targetCeil: 0.35, idealAdmit: 0.18, idealSchoolGpa: 3.85 };
  } else {
    // SAT-only fallback
    const s = studentSat!;
    if (s < 1200) band = { skipBelow: 0.2, reachCeil: 0.38, targetCeil: 0.65, idealAdmit: 0.5, idealSchoolGpa: 3.4 };
    else if (s < 1350) band = { skipBelow: 0.12, reachCeil: 0.28, targetCeil: 0.55, idealAdmit: 0.38, idealSchoolGpa: 3.55 };
    else if (s < 1480) band = { skipBelow: 0.08, reachCeil: 0.2, targetCeil: 0.42, idealAdmit: 0.26, idealSchoolGpa: 3.7 };
    else band = { skipBelow: 0.05, reachCeil: 0.14, targetCeil: 0.32, idealAdmit: 0.16, idealSchoolGpa: 3.9 };
  }

  // Ambition = slight risk shift, not a new stratosphere
  if (ambition === "ambitious") {
    band = {
      ...band,
      skipBelow: Math.max(0.04, band.skipBelow - 0.03),
      reachCeil: Math.max(band.skipBelow + 0.06, band.reachCeil - 0.04),
      targetCeil: Math.max(band.reachCeil + 0.08, band.targetCeil - 0.04),
      idealAdmit: Math.max(0.12, band.idealAdmit - 0.04),
    };
  } else if (ambition === "conservative") {
    band = {
      ...band,
      skipBelow: Math.min(0.35, band.skipBelow + 0.04),
      reachCeil: Math.min(0.55, band.reachCeil + 0.05),
      targetCeil: Math.min(0.8, band.targetCeil + 0.05),
      idealAdmit: Math.min(0.7, band.idealAdmit + 0.06),
    };
  }

  // SAT can tighten or loosen slightly when both exist
  if (studentSat != null && g != null) {
    if (studentSat >= 1500 && g >= 3.7) {
      band.skipBelow = Math.max(0.04, band.skipBelow - 0.02);
    }
    if (studentSat < 1200 && g < 3.6) {
      band.skipBelow = Math.min(0.3, band.skipBelow + 0.03);
    }
  }

  return band;
}

/**
 * Map a school to reach/target/safety for THIS student.
 * Admit rate is the primary signal; GPA/SAT gaps refine. Never call a
 * hyper-selective school a "target" for a mid GPA.
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

  // Hard floor: ultra-selective is always reach if it appears (must-include)
  if (admit != null && admit < band.skipBelow) return "reach";
  if (admit != null && admit < 0.1 && (studentGpa == null || studentGpa < 3.85)) return "reach";

  // Primary: admit-rate windows
  if (admit != null) {
    if (admit < band.reachCeil) return "reach";
    if (admit < band.targetCeil) {
      // Soften: if SAT is way below mid-50, bump to reach even in "target" admit band
      if (studentSat != null && mid != null && studentSat < mid - 100) return "reach";
      if (studentGpa != null && schoolGpa != null && schoolGpa - studentGpa > 0.35) return "reach";
      return "target";
    }
    // High admit — safety unless student is well below school academic profile
    if (studentSat != null && mid != null && studentSat < mid - 120) return "target";
    if (studentGpa != null && schoolGpa != null && schoolGpa - studentGpa > 0.4) return "target";
    return "safety";
  }

  // No admit rate: use rank + GPA gap
  if (studentGpa != null && schoolGpa != null) {
    const gap = studentGpa - schoolGpa;
    if (gap <= -0.3) return "reach";
    if (gap >= 0.25) return "safety";
    return "target";
  }
  if (studentSat != null && mid != null) {
    if (studentSat < mid - 90) return "reach";
    if (studentSat > mid + 60) return "safety";
    return "target";
  }
  if (u.rank <= 40) return "reach";
  if (u.rank <= 120) return "target";
  return "safety";
}

/**
 * How far this school is from a good academic fit. Lower = better for that tier.
 * Strongly prefers schools near the student's band — not prestige rank.
 */
function fitScore(
  u: UsNewsCollege,
  studentSat: number | null,
  studentGpa: number | null,
  ambition: ListAmbition = "balanced"
): number {
  const band = selectivityBand(studentGpa, studentSat, ambition);
  let score = 0;
  const mid = satMid(u);

  if (u.admitRate != null) {
    score += Math.abs(u.admitRate - band.idealAdmit) * 120;
    // Extra penalty for lottery schools even if somehow in pool
    if (u.admitRate < band.skipBelow) score += 80;
    if (u.admitRate < 0.1 && (studentGpa == null || studentGpa < 3.8)) score += 50;
  } else {
    score += Math.abs(u.rank - 90) / 15;
  }

  if (studentSat != null && mid != null) {
    score += Math.abs(studentSat - mid) / 8;
  }
  if (studentGpa != null && typeof u.gpa === "number") {
    score += Math.abs(studentGpa - u.gpa) * 35;
    score += Math.abs(u.gpa - band.idealSchoolGpa) * 15;
  }

  // Mild anti-prestige bias for mid profiles so we don't fill with brand names
  if (studentGpa != null && studentGpa < 3.7 && u.rank <= 20) score += 25;
  if (studentGpa != null && studentGpa < 3.55 && u.rank <= 40) score += 12;

  score += u.rank * 0.015;
  return score;
}

/**
 * Drop schools that are unrealistically selective for this profile from the
 * seed pool. Must-includes always stay (and get labeled reach if needed).
 *
 * "Ambitious" opens the door only slightly — still no Yale-as-target territory.
 */
function academicallyPlausible(
  u: UsNewsCollege,
  studentSat: number | null,
  studentGpa: number | null,
  ambition: ListAmbition
): boolean {
  const band = selectivityBand(studentGpa, studentSat, ambition);
  const admit = u.admitRate;
  const mid = satMid(u);

  if (admit != null && admit < band.skipBelow) return false;

  // Absolute lottery guardrails by GPA (must-includes bypass this function)
  if (studentGpa != null) {
    if (studentGpa < 3.35 && admit != null && admit < 0.18) return false;
    if (studentGpa < 3.55 && admit != null && admit < 0.1) return false;
    if (studentGpa < 3.7 && admit != null && admit < 0.06) return false;
    if (typeof u.gpa === "number" && u.gpa - studentGpa > 0.5) return false;
    if (ambition !== "ambitious" && typeof u.gpa === "number" && u.gpa - studentGpa > 0.4) {
      return false;
    }
  }

  if (studentSat != null && mid != null) {
    // Don't seed schools whose mid-50 is > ~150 points above student (ambitious: 180)
    const maxGap = ambition === "ambitious" ? 180 : ambition === "conservative" ? 100 : 140;
    if (mid - studentSat > maxGap) return false;
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
  maxUc = 6
): College[] {
  const have = new Set(list.map((c) => c.slug));
  const ucAlready = list.filter(isUcCampus).length;
  if (ucAlready >= maxUc) return list.map(withUcTag);

  const ucPool = US_NEWS_TOP_250.filter(
    (u) => isUcCampus(u) && !have.has(u.slug) && academicallyPlausible(u, studentSat, studentGpa, ambition)
  ).sort(
    (a, b) =>
      fitScore(a, studentSat, studentGpa, ambition) - fitScore(b, studentSat, studentGpa, ambition)
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
  // Campus count target (UCs can push total campuses higher since they share 1 app slot).
  const target = Math.max(6, Math.min(16, params.targetCount ?? 12));
  const prefs = params.prefs;
  const ambition: ListAmbition = prefs.ambition || "balanced";
  const studentSat = parseSat(params.sat);
  const studentGpa =
    parseGpa(params.gpaUnweighted) ?? parseGpa(params.gpaWeighted);
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
      if (opts.strictAcademics && !academicallyPlausible(u, studentSat, studentGpa, ambition)) {
        return false;
      }
      return true;
    });
  }

  let candidates =
    need > 0
      ? pool({ strictPrefs: true, strictAcademics: true, skipUc: true })
      : [];
  if (need > 0 && candidates.length < need + 10) {
    candidates = pool({ strictPrefs: false, strictAcademics: true, skipUc: true });
  }
  if (need > 0 && candidates.length < need + 6) {
    candidates = pool({ strictPrefs: false, strictAcademics: false, skipUc: true });
  }

  const byTier: Record<Tier, UsNewsCollege[]> = { reach: [], target: [], safety: [] };
  for (const u of candidates) {
    byTier[classifyTier(u, studentSat, studentGpa, ambition)].push(u);
  }
  for (const t of Object.keys(byTier) as Tier[]) {
    byTier[t].sort(
      (a, b) =>
        fitScore(a, studentSat, studentGpa, ambition) -
        fitScore(b, studentSat, studentGpa, ambition)
    );
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
  if (wantsUcCluster(prefs, params.location, prefs.notes, result)) {
    result = expandUcCampuses(result, studentSat, studentGpa, ambition, 7);
  } else if (result.some(isUcCampus)) {
    // Already has a UC must-include — still safe to add sibling campuses (same app).
    result = expandUcCampuses(result, studentSat, studentGpa, ambition, 5);
  }

  return result.map(withUcTag);
}
