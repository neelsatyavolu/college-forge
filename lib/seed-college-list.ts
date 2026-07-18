/**
 * Deterministic preliminary college list for onboarding.
 * Must-include schools stay; we fill to ~12 from US News top ~250 using
 * list prefs (ambition, setting, region). LLMs often only keep must-haves
 * if left to call upsert_college many times — this guarantees a real shortlist.
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

/** How many of each tier we aim for (before must-haves shift the mix). */
function quota(ambition: ListAmbition): Record<Tier, number> {
  if (ambition === "ambitious") return { reach: 5, target: 4, safety: 3 };
  if (ambition === "conservative") return { reach: 2, target: 4, safety: 6 };
  return { reach: 3, target: 5, safety: 4 };
}

function parseSat(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "" || raw === "—") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n < 400 || n > 1600) return null;
  return Math.round(n);
}

function shortName(name: string): string {
  return name.replace(/^The\s+/i, "").replace(/\s*[-–—].*$/, "").slice(0, 28);
}

function settingMatch(
  schoolSetting: UsNewsCollege["setting"],
  wanted: string[]
): boolean {
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

function classifyTier(
  u: UsNewsCollege,
  studentSat: number | null
): Tier {
  const admit = u.admitRate;
  const mid =
    typeof u.sat25 === "number" && typeof u.sat75 === "number"
      ? (u.sat25 + u.sat75) / 2
      : null;

  if (studentSat != null && mid != null) {
    if (studentSat < mid - 80) return "reach";
    if (studentSat > mid + 40 && (admit == null || admit >= 0.2)) return "safety";
    if (studentSat >= mid - 40 && studentSat <= mid + 40) return "target";
    // borderline
    if (studentSat < mid) return "reach";
    return "target";
  }

  if (admit == null) {
    // rank as proxy: lower rank # = more selective
    if (u.rank <= 30) return "reach";
    if (u.rank <= 80) return "target";
    return "safety";
  }
  if (admit < 0.12) return "reach";
  if (admit < 0.35) return "target";
  return "safety";
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

function shuffleStable<T>(arr: T[], seed: string): T[] {
  // Simple seeded shuffle so the same prefs get a stable but not purely rank-sorted list.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 16777619);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type SeedCollegeListParams = {
  existing: College[];
  prefs: OnboardingListPrefs;
  /** Student superscore if known */
  sat?: string | number | null;
  intended?: string;
  /** Total schools to aim for (including must-haves). Default 12. */
  targetCount?: number;
};

/**
 * Keep existing schools (must-includes), fill remaining slots from US News
 * filtered by prefs, with a reach/target/safety mix from ambition.
 */
export function seedCollegeList(params: SeedCollegeListParams): College[] {
  const target = Math.max(6, Math.min(16, params.targetCount ?? 12));
  const prefs = params.prefs;
  const ambition: ListAmbition = prefs.ambition || "balanced";
  const studentSat = parseSat(params.sat);
  const settings = (prefs.settings || []).filter(Boolean);
  const regions = (prefs.regions || []).filter(Boolean);

  // Preserve existing order; ensure priority flags stay meaningful.
  const kept: College[] = params.existing.map((c) => ({ ...c }));
  const have = new Set(kept.map((c) => c.slug));

  // Ensure tiers on existing when missing
  for (let i = 0; i < kept.length; i++) {
    if (kept[i].tier) continue;
    const hit = US_NEWS_TOP_250.find((u) => u.slug === kept[i].slug);
    if (hit) {
      const tier = classifyTier(hit, studentSat);
      kept[i] = {
        ...kept[i],
        tier,
        verdict: kept[i].verdict || verdictFor(tier),
        rank: kept[i].rank ?? hit.rank,
        photo: kept[i].photo ?? hit.photo,
        admit: kept[i].admit || (hit.admitRate != null ? `${Math.round(hit.admitRate * 1000) / 10}%` : undefined),
        satRange:
          kept[i].satRange ||
          (hit.sat25 != null && hit.sat75 != null ? `${hit.sat25}–${hit.sat75}` : undefined),
      };
    } else {
      kept[i] = { ...kept[i], tier: "target", verdict: kept[i].verdict || verdictFor("target") };
    }
  }

  if (kept.length >= target) return kept;

  const need = target - kept.length;
  const q = quota(ambition);

  // Count existing tiers toward quota
  const filled: Record<Tier, number> = { reach: 0, target: 0, safety: 0 };
  for (const c of kept) {
    const t = (c.tier as Tier) || "target";
    if (t in filled) filled[t]++;
  }

  function pool(strict: boolean): UsNewsCollege[] {
    return US_NEWS_TOP_250.filter((u) => {
      if (have.has(u.slug)) return false;
      if (strict) {
        if (!settingMatch(u.setting, settings)) return false;
        if (!regionMatch(u.state, regions)) return false;
      }
      return true;
    });
  }

  // Prefer strict filter; if too thin, relax.
  let candidates = pool(true);
  if (candidates.length < need + 8) candidates = pool(false);

  const seedKey = [
    ambition,
    settings.join(","),
    regions.join(","),
    params.intended || "",
    studentSat ?? "",
  ].join("|");

  const byTier: Record<Tier, UsNewsCollege[]> = { reach: [], target: [], safety: [] };
  for (const u of candidates) {
    byTier[classifyTier(u, studentSat)].push(u);
  }
  for (const t of Object.keys(byTier) as Tier[]) {
    // Prefer a mix of selectivity within tier: sort by rank then light shuffle
    byTier[t].sort((a, b) => a.rank - b.rank);
    byTier[t] = shuffleStable(byTier[t], seedKey + t).sort((a, b) => {
      // keep roughly rank-ordered but break ties with shuffle order preserved via stable-ish
      return a.rank - b.rank;
    });
    // Interleave top and mid ranks for variety
    const top = byTier[t].filter((_, i) => i % 3 !== 2);
    const rest = byTier[t].filter((_, i) => i % 3 === 2);
    byTier[t] = [...top, ...rest];
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

  // Fill remaining quota slots first
  for (const tier of ["reach", "target", "safety"] as Tier[]) {
    const want = Math.max(0, q[tier] - filled[tier]);
    take(tier, want);
  }

  // Top up to `need` from any tier (prefer target, then safety, then reach)
  let remaining = need - added.length;
  for (const tier of ["target", "safety", "reach"] as Tier[]) {
    if (remaining <= 0) break;
    const before = added.length;
    take(tier, remaining);
    remaining -= added.length - before;
  }

  return [...kept, ...added];
}
