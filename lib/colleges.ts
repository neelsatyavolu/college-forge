import type { College, Workspace } from "./store";
import {
  US_NEWS_BY_SCORECARD_ID,
  US_NEWS_BY_SLUG,
  type UsNewsCollege,
} from "./us-news-rankings";

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

/**
 * Upsert a college into a workspace by slug, immutably. Shared by the AI's
 * upsert_college tool and the Explore "Add to my list" button so both behave
 * identically (same slug rules, same single-priority invariant).
 */
export function upsertCollegeInto(ws: Workspace, incoming: College): Workspace {
  const exists = ws.colleges.some((c) => c.slug === incoming.slug);
  const colleges = exists
    ? ws.colleges.map((c) => {
        if (c.slug !== incoming.slug) return c;
        // Only overwrite fields the caller actually supplied.
        const merged: Record<string, unknown> = { ...c };
        for (const [k, v] of Object.entries(incoming)) {
          if (v !== undefined && v !== null) merged[k] = v;
        }
        return merged as College;
      })
    : [...ws.colleges, incoming];

  // At most one priority (ED) school at a time.
  const next = incoming.priority
    ? colleges.map((c) => ({ ...c, priority: c.slug === incoming.slug }))
    : colleges;

  return { ...ws, colleges: next };
}

export function removeCollegeFrom(ws: Workspace, slug: string): Workspace {
  return { ...ws, colleges: ws.colleges.filter((c) => c.slug !== slug) };
}

// ── College Scorecard mapping ─────────────────────────────────────────────

/** Scorecard `school.locale` → the design's campus-setting buckets. */
export function localeToSetting(locale: number | null): string | null {
  if (typeof locale !== "number") return null;
  if (locale >= 11 && locale <= 13) return "urban";
  if (locale >= 21 && locale <= 23) return "suburban";
  if (locale >= 31 && locale <= 33) return "town";
  if (locale >= 41 && locale <= 43) return "rural";
  return null;
}

// ── Scorecard code → label maps (mirrors the reference hub) ───────────────

export const OWNERSHIP_LABEL: Record<number, string> = {
  1: "Public",
  2: "Private, nonprofit",
  3: "Private, for-profit",
};

/** Scorecard ADM_REQ / admissions.test_requirements codes. */
export const TEST_POLICY_LABEL: Record<number, string> = {
  1: "Required",
  2: "Recommended",
  3: "Neither required nor recommended",
  4: "Unknown",
  5: "Considered but not required",
};

export const CREDENTIAL_LABEL: Record<number, string> = {
  1: "Certificate",
  2: "Associate",
  3: "Bachelor's",
  4: "Post-bacc Certificate",
  5: "Master's",
  6: "Doctoral",
  7: "Professional",
  8: "Graduate Certificate",
};

/** CIP 2-digit series → field-of-study area, for grouping the programs list. */
export const CIP_AREA: Record<string, string> = {
  "01": "Agriculture", "03": "Natural Resources", "04": "Architecture",
  "05": "Area & Ethnic Studies", "09": "Communication & Journalism",
  "10": "Communications Technology", "11": "Computer & Information Sciences",
  "12": "Personal & Culinary Services", "13": "Education", "14": "Engineering",
  "15": "Engineering Technology", "16": "Foreign Languages",
  "19": "Family & Consumer Sciences", "22": "Legal Studies", "23": "English",
  "24": "Liberal Arts & General Studies", "25": "Library Science",
  "26": "Biological Sciences", "27": "Mathematics & Statistics",
  "28": "Military Science", "29": "Military Technologies",
  "30": "Interdisciplinary Studies", "31": "Parks, Recreation & Fitness",
  "38": "Philosophy & Religious Studies", "39": "Theology & Religious Vocations",
  "40": "Physical Sciences", "41": "Science Technologies", "42": "Psychology",
  "43": "Homeland Security & Law Enforcement",
  "44": "Public Administration & Social Service", "45": "Social Sciences",
  "46": "Construction Trades", "47": "Mechanic & Repair Technologies",
  "48": "Precision Production", "49": "Transportation",
  "50": "Visual & Performing Arts", "51": "Health Professions",
  "52": "Business & Management", "54": "History",
};

export function cipArea(code: string): string {
  return CIP_AREA[String(code).slice(0, 2)] ?? "Other";
}

/** One program (field of study) offered by a school. */
export type ProgramRow = {
  code: string;
  title: string;
  area: string;
  credential: string;
  awards: number | null;
  /** Median earnings 4 years after completing this program, at this school. */
  earnings4: number | null;
  /** National median for the same field + credential — the comparison baseline. */
  national4: number | null;
};

export type ScorecardCollege = {
  id: number;
  name: string;
  alias: string | null;
  city: string;
  state: string;
  url: string | null;
  ownership: number | null;
  locale: number | null;
  size: number | null;
  admitRate: number | null;
  sat25: number | null;
  sat75: number | null;
  act25: number | null;
  act75: number | null;
  netPrice: number | null;
  tuitionIn: number | null;
  tuitionOut: number | null;
  completion4yr: number | null;
  earnings10yr: number | null;
};

const money = (n: number | null) => (typeof n === "number" ? `$${Math.round(n).toLocaleString()}` : undefined);
const pct = (n: number | null) => (typeof n === "number" ? `${Math.round(n * 100)}%` : undefined);
const range = (a: number | null, b: number | null) =>
  typeof a === "number" && typeof b === "number" ? `${a}–${b}` : undefined;

/** A short display name: prefer a real alias (UCLA, MIT) over the full name. */
function shortName(name: string, alias: string | null): string {
  const first = (alias ?? "")
    .split(/[|;,]/)
    .map((a) => a.trim())
    .filter((a) => a.length >= 2 && a.length <= 12 && !/^\d+$/.test(a))[0];
  if (first) return first;
  return name.replace(/^The\s+/i, "").replace(/\s*[-–—].*$/, "").slice(0, 28);
}

/**
 * Attach US News National Universities rank + campus photo when we know them.
 * Scorecard never publishes either; photos and ranks come from the curated
 * top-250 list (see lib/us-news-rankings.ts).
 */
export function withUsNews(college: College, scorecardId?: number | null): College {
  const byId =
    typeof scorecardId === "number" && scorecardId > 0
      ? US_NEWS_BY_SCORECARD_ID.get(scorecardId)
      : undefined;
  const bySlug = US_NEWS_BY_SLUG.get(college.slug);
  const hit = byId || bySlug;
  if (!hit) return college;
  return {
    ...college,
    rank: college.rank ?? hit.rank,
    photo: college.photo || hit.photo || null,
    scorecardId: college.scorecardId ?? hit.scorecardId,
  };
}

/** Convert a US News top-250 entry into the hub's light College row. */
export function usNewsToCollege(u: UsNewsCollege): College {
  const setting = u.setting;
  const locationBits = [u.city, u.state].filter(Boolean).join(", ");
  return {
    slug: u.slug,
    name: u.name,
    short: shortName(u.name, null),
    location: setting
      ? `${locationBits} · ${setting[0].toUpperCase()}${setting.slice(1)}`
      : locationBits,
    setting,
    rank: u.rank,
    admit: pct(u.admitRate),
    satRange: range(u.sat25, u.sat75),
    gpa: typeof u.gpa === "number" ? u.gpa.toFixed(2) : undefined,
    photo: u.photo,
    scorecardId: u.scorecardId,
  };
}

/**
 * Turn a Scorecard record into the hub's College shape. Fields the Scorecard
 * doesn't publish (rank, application plans/deadlines, supplements) are left
 * undefined — the UI renders those as "—" and the copilot can fill them in.
 * When the school is in the US News top 250 we fill rank + photo.
 */
export function scorecardToCollege(r: ScorecardCollege): College {
  const setting = localeToSetting(r.locale);
  const locationBits = [r.city, r.state].filter(Boolean).join(", ");
  const base: College = {
    slug: slugify(r.name),
    name: r.name,
    short: shortName(r.name, r.alias),
    location: setting ? `${locationBits} · ${setting[0].toUpperCase()}${setting.slice(1)}` : locationBits,
    setting: setting ?? undefined,
    admit: pct(r.admitRate),
    satRange: range(r.sat25, r.sat75),
    act: range(r.act25, r.act75),
    size: typeof r.size === "number" ? r.size.toLocaleString() : undefined,
    netPrice: money(r.netPrice),
    grad6: pct(r.completion4yr),
    earnings: money(r.earnings10yr),
    photo: null,
    scorecardId: r.id || undefined,
  };
  return withUsNews(base, r.id);
}

/**
 * Compare the applicant's SAT to a school's 25th/75th percentile band to
 * produce the design's fit tag + tier suggestion. Mirrors how the reference
 * hub scores fit: above 75th = strong, inside the band = close, below 25th
 * = reach.
 */
export function fitFor(college: College, applicantSat: string | undefined) {
  const sat = Number(String(applicantSat ?? "").replace(/[^\d]/g, ""));
  const band = String(college.satRange ?? "").match(/(\d+)\D+(\d+)/);
  if (!sat || !band) return { tags: [] as { label: string; tone: string }[], tier: undefined as College["tier"] };

  const lo = Number(band[1]);
  const hi = Number(band[2]);
  const tone = sat >= hi ? "strong" : sat >= lo ? "close" : "reach";
  const label = `SAT: ${tone}`;

  // Admit rate dominates the tier call; SAT position adjusts it.
  const admit = Number(String(college.admit ?? "").replace(/[^\d]/g, ""));
  let tier: College["tier"] | undefined;
  if (admit) {
    if (admit < 20) tier = "reach";
    else if (admit < 50) tier = tone === "strong" ? "target" : "reach";
    else tier = tone === "reach" ? "target" : "safety";
  }
  return { tags: [{ label, tone }], tier };
}
