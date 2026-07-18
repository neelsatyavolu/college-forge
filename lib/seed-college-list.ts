/**
 * Deterministic preliminary college list for onboarding.
 * Must-include schools stay; we fill to ~12 from US News top ~250 using
 * student academics (GPA / SAT) + list prefs. Without GPA matching the pool
 * sorts by rank and dumps Ivies on every student — bad for a 3.4 UW profile.
 */

import type { College, OnboardingListPrefs, ListAmbition } from "./store";
import { US_NEWS_TOP_250, type UsNewsCollege } from "./us-news-rankings";

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

function quota(ambition: ListAmbition): Record<Tier, number> {
  if (ambition === "ambitious") return { reach: 4, target: 5, safety: 3 };
  if (ambition === "conservative") return { reach: 2, target: 4, safety: 6 };
  return { reach: 3, target: 5, safety: 4 };
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
 * Map a school to reach/target/safety for THIS student.
 * GPA-first when we have a school avg GPA; SAT band second; admit rate last.
 */
function classifyTier(
  u: UsNewsCollege,
  studentSat: number | null,
  studentGpa: number | null
): Tier {
  const admit = u.admitRate;
  const mid = satMid(u);
  const schoolGpa = typeof u.gpa === "number" ? u.gpa : null;

  // GPA gap (UW-ish 4.0 scale). school.gpa in our dataset is typically unweighted avg.
  if (studentGpa != null && schoolGpa != null) {
    const gap = studentGpa - schoolGpa;
    if (gap <= -0.25) return "reach";
    if (gap >= 0.2 && (admit == null || admit >= 0.25)) return "safety";
    if (gap >= -0.1 && gap <= 0.15) return "target";
  }

  if (studentSat != null && mid != null) {
    if (studentSat < mid - 80) return "reach";
    if (studentSat > mid + 50 && (admit == null || admit >= 0.25)) return "safety";
    if (studentSat >= mid - 50 && studentSat <= mid + 40) return "target";
    if (studentSat < mid) return "reach";
    return "target";
  }

  // GPA alone vs selectivity proxy when school has no gpa field
  if (studentGpa != null) {
    // Rough bands: elite avg admits need ~3.9+; mid-selective ~3.5–3.8; broader 3.3–
    if (studentGpa < 3.5) {
      if (admit != null && admit < 0.2) return "reach";
      if (admit != null && admit < 0.45) return "target";
      if (admit != null) return "safety";
      if (u.rank <= 40) return "reach";
      if (u.rank <= 100) return "target";
      return "safety";
    }
    if (studentGpa < 3.75) {
      if (admit != null && admit < 0.12) return "reach";
      if (admit != null && admit < 0.35) return "target";
      if (admit != null) return "safety";
      if (u.rank <= 25) return "reach";
      if (u.rank <= 80) return "target";
      return "safety";
    }
    // strong GPA 3.75+
    if (admit != null && admit < 0.1) return "reach";
    if (admit != null && admit < 0.3) return "target";
    if (admit != null) return "safety";
  }

  if (admit == null) {
    if (u.rank <= 30) return "reach";
    if (u.rank <= 80) return "target";
    return "safety";
  }
  if (admit < 0.12) return "reach";
  if (admit < 0.35) return "target";
  return "safety";
}

/**
 * How far this school is from a good academic fit. Lower = better target.
 * Used to rank candidates inside each tier so 3.48 UW doesn't get Princeton first.
 */
function fitScore(
  u: UsNewsCollege,
  studentSat: number | null,
  studentGpa: number | null
): number {
  let score = 0;
  const mid = satMid(u);
  if (studentSat != null && mid != null) {
    score += Math.abs(studentSat - mid) / 10;
  }
  if (studentGpa != null && typeof u.gpa === "number") {
    score += Math.abs(studentGpa - u.gpa) * 40;
  } else if (studentGpa != null && u.admitRate != null) {
    // Prefer admit rates that match GPA band
    const idealAdmit =
      studentGpa < 3.4 ? 0.55 : studentGpa < 3.6 ? 0.4 : studentGpa < 3.8 ? 0.25 : 0.12;
    score += Math.abs(u.admitRate - idealAdmit) * 100;
  } else {
    // No academics: mild preference for mid ranks over pure top
    score += Math.abs(u.rank - 80) / 20;
  }
  // Slight diversity: don't always pick rank 1–10
  score += u.rank * 0.02;
  return score;
}

/**
 * Drop schools that are unrealistically selective for this academic profile
 * from the *seed pool* (must-includes always stay). Extreme reaches still
 * allowed sparingly via tier classification.
 */
function academicallyPlausible(
  u: UsNewsCollege,
  studentSat: number | null,
  studentGpa: number | null,
  ambition: ListAmbition
): boolean {
  // Ultra-elite (admit < 8%) without strong academics → only if ambitious, and even then as reach only
  const ultra = u.admitRate != null && u.admitRate < 0.08;
  const verySelective = u.admitRate != null && u.admitRate < 0.15;

  if (studentGpa != null && studentGpa < 3.55) {
    if (ultra && ambition !== "ambitious") return false;
    if (ultra && studentGpa < 3.4) return false; // skip ivies entirely for lower GPA unless must-include
    if (verySelective && studentGpa < 3.3 && ambition === "conservative") return false;
  }

  if (studentSat != null && studentSat < 1280) {
    const mid = satMid(u);
    if (mid != null && mid - studentSat > 200 && ambition === "conservative") return false;
    if (mid != null && mid - studentSat > 250) return false;
  }

  if (studentGpa != null && typeof u.gpa === "number") {
    // School avg GPA more than 0.55 above student → skip unless ambitious reach
    if (u.gpa - studentGpa > 0.55 && ambition !== "ambitious") return false;
    if (u.gpa - studentGpa > 0.7) return false;
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
  return {
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
  targetCount?: number;
};

export function seedCollegeList(params: SeedCollegeListParams): College[] {
  const target = Math.max(6, Math.min(16, params.targetCount ?? 12));
  const prefs = params.prefs;
  const ambition: ListAmbition = prefs.ambition || "balanced";
  const studentSat = parseSat(params.sat);
  const studentGpa =
    parseGpa(params.gpaUnweighted) ?? parseGpa(params.gpaWeighted);
  const settings = (prefs.settings || []).filter(Boolean);
  const regions = (prefs.regions || []).filter(Boolean);

  // Dedup existing (must-includes can collide with prior list after redo)
  const kept: College[] = dedupeColleges(params.existing.map((c) => ({ ...c })));
  const have = new Set(kept.map((c) => c.slug));

  for (let i = 0; i < kept.length; i++) {
    const hit = US_NEWS_TOP_250.find((u) => u.slug === kept[i].slug);
    if (hit) {
      const tier = classifyTier(hit, studentSat, studentGpa);
      kept[i] = {
        ...kept[i],
        tier: kept[i].tier || tier,
        verdict: kept[i].verdict || verdictFor(tier),
        rank: kept[i].rank ?? hit.rank,
        photo: kept[i].photo ?? hit.photo,
        admit:
          kept[i].admit ||
          (hit.admitRate != null ? `${Math.round(hit.admitRate * 1000) / 10}%` : undefined),
        satRange:
          kept[i].satRange ||
          (hit.sat25 != null && hit.sat75 != null ? `${hit.sat25}–${hit.sat75}` : undefined),
        scorecardId: kept[i].scorecardId ?? hit.scorecardId,
      };
    } else if (!kept[i].tier) {
      kept[i] = { ...kept[i], tier: "target", verdict: kept[i].verdict || verdictFor("target") };
    }
  }

  if (kept.length >= target) return kept.slice(0, target);

  const need = target - kept.length;
  const q = quota(ambition);
  const filled: Record<Tier, number> = { reach: 0, target: 0, safety: 0 };
  for (const c of kept) {
    const t = (c.tier as Tier) || "target";
    if (t in filled) filled[t]++;
  }

  function pool(opts: { strictPrefs: boolean; strictAcademics: boolean }): UsNewsCollege[] {
    return US_NEWS_TOP_250.filter((u) => {
      if (have.has(u.slug)) return false;
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

  // Prefer prefs+academics; relax prefs first, then academics if still thin
  let candidates = pool({ strictPrefs: true, strictAcademics: true });
  if (candidates.length < need + 10) {
    candidates = pool({ strictPrefs: false, strictAcademics: true });
  }
  if (candidates.length < need + 6) {
    candidates = pool({ strictPrefs: false, strictAcademics: false });
  }

  const byTier: Record<Tier, UsNewsCollege[]> = { reach: [], target: [], safety: [] };
  for (const u of candidates) {
    byTier[classifyTier(u, studentSat, studentGpa)].push(u);
  }
  for (const t of Object.keys(byTier) as Tier[]) {
    // Best academic fit first (not pure prestige rank)
    byTier[t].sort(
      (a, b) => fitScore(a, studentSat, studentGpa) - fitScore(b, studentSat, studentGpa)
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

  return dedupeColleges([...kept, ...added]);
}
