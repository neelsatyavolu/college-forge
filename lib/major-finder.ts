/**
 * "Find your major" for undecided students during onboarding. The AI asks what the student enjoys
 * and would rather avoid (as interest keys below), and this scores Forge's broad majors against
 * those answers and the courses, AP scores and activities already on the profile. Only majors that
 * most colleges in Forge's data offer are suggested, and majors that many colleges admit to
 * separately carry a caution, stronger when the student's courses don't show preparation yet.
 */
import careerData from "../public/data/career-ranking.json";
import type { CareerData } from "./career-ranking";
import type { Workspace } from "./store";

const CAREER = careerData as unknown as CareerData;

/** What the student might enjoy. Keys go in ask_question option values; labels are shown. */
export const INTERESTS: Record<string, string> = {
  build: "Building things: code, robots, machines",
  numbers: "Math, logic and puzzles",
  science: "How the physical world works: physics, chemistry",
  life: "Living things and the human body",
  environment: "Nature, climate and the environment",
  people: "Why people think and act the way they do",
  society: "Politics, law and how society runs",
  past: "History, languages and other cultures",
  writing: "Reading, writing and arguing a point",
  media: "Media, storytelling and communicating",
  create: "Art, music, design or performance",
  money: "Business, money and running things",
};

/** Which interests each major draws on. Majors missing here are never suggested. */
const TAGS: Record<string, string[]> = {
  econ: ["money", "numbers", "society"],
  business: ["money", "people"],
  cs: ["build", "numbers"],
  comm: ["media", "writing", "people"],
  bio: ["life", "science"],
  eng: ["build", "science", "numbers"],
  psych: ["people", "life"],
  polisci: ["society", "writing"],
  socsci: ["people", "society", "past"],
  english: ["writing", "create"],
  history: ["past", "society", "writing"],
  arts: ["create", "media"],
  physsci: ["science", "numbers"],
  math: ["numbers"],
  lang: ["past", "writing"],
  envsci: ["environment", "life", "science"],
};

/** Courses and activities that show preparation for each major. */
const PREP: Record<string, RegExp> = {
  econ: /econ|statistic|calculus/,
  business: /business|econ|accounting|marketing|financ|entrepreneur|\bdeca\b|\bfbla\b/,
  cs: /computer|programming|coding|\bcs\b|software|robotic|hackathon|app develop/,
  comm: /journalism|newspaper|yearbook|media|film|broadcast|speech|debate|communicat|podcast/,
  bio: /biolog|anatomy|physiolog|chemistry|\bhosa\b|science olympiad|research/,
  eng: /physics|calculus|engineer|robotic|\bcad\b|science olympiad/,
  psych: /psycholog|sociolog|peer counsel|mental health/,
  polisci: /government|politic|civics|debate|model un|\bmun\b|mock trial|student council|student government/,
  socsci: /sociolog|anthropolog|human geography|psycholog|government|economics/,
  english: /english|literature|creative writing|journalism|literary|writing/,
  history: /history/,
  arts: /\bart\b|studio|drawing|painting|music|band|orchestra|choir|theat|drama|dance|film|design|photograph/,
  physsci: /physics|chemistry|earth science|astronom/,
  math: /calculus|statistic|\bmath|precalc|linear algebra|\bamc\b|mathcounts/,
  lang: /spanish|french|chinese|mandarin|german|latin|japanese|italian|korean|arabic|world language|foreign language/,
  envsci: /environment|earth science|ecolog|sustainab|biolog|garden|outdoor/,
};

/** A major counts as broad when at least this share of colleges in Forge's data publish outcomes for it. */
export const BROAD_SHARE = 0.5;
/** A major is flagged as hard to get into when at least this share of checked colleges rate entry competitive. */
const HARD_SHARE = 0.25;
/** Majors the data doesn't rate but that many universities admit to separately. */
const ADMITS_SEPARATELY = new Set(["eng"]);

export type MajorSuggestion = {
  key: string;
  label: string;
  score: number;
  /** The student's interests this major draws on, as labels. */
  matches: string[];
  readiness: "strong" | "some" | "none";
  /** Courses, AP scores and activities on the profile that show preparation. */
  evidence: string[];
  offeredAt: string;
  caution?: string;
};

function breadth(key: string): number {
  return CAREER.schools.filter((s) => s.tracks?.[key]).length;
}

/** Share of hand-checked colleges where getting into (or switching into) the major is competitive or harder. */
function hardShare(key: string): { hard: number; checked: number } {
  const levels = CAREER.schools.map((s) => s.switch?.lv?.[key]).filter((v): v is number => typeof v === "number" && v > 0);
  return { hard: levels.filter((v) => v >= 3).length, checked: levels.length };
}

function caution(key: string, label: string, readiness: MajorSuggestion["readiness"]): string | undefined {
  const { hard, checked } = hardShare(key);
  const base = checked > 0 && hard / checked >= HARD_SHARE
    ? `Admission to ${label} is competitive at ${hard} of the ${checked} colleges Forge checked`
    : ADMITS_SEPARATELY.has(key) ? `Many universities admit to ${label} separately, with a higher bar` : undefined;
  if (!base) return undefined;
  return readiness === "none" ? `${base}, and your courses don't show preparation for it yet.` : `${base}.`;
}

/** Everything on the profile that can show preparation: course names, AP scores of 4-5, activities. */
function profileEvidence(ws: Workspace): { label: string; search: string; strong: boolean }[] {
  const p = ws.profile;
  const courses = [...p.coursework.aps, ...p.coursework.honors, ...p.coursework.senior].map((c) => ({ label: c, search: c, strong: false }));
  const aps = p.testing.aps.filter((a) => Number(a.score) >= 4).map((a) => ({ label: `AP ${a.course} (${a.score})`, search: a.course, strong: true }));
  const acts = p.activities.map((a) => ({ label: a.name, search: [a.name, a.type, a.role, a.desc].filter(Boolean).join(" "), strong: false }));
  return [...courses, ...aps, ...acts].map((e) => ({ ...e, search: e.search.toLowerCase() }));
}

const clean = (keys: unknown): string[] =>
  (Array.isArray(keys) ? keys : []).filter((k): k is string => typeof k === "string" && k in INTERESTS);

/**
 * Ranks the broad majors for this student. interests and dislikes are INTERESTS keys; unknown keys
 * are ignored. With no interests, majors are ranked by preparation alone.
 */
export function suggestMajors(ws: Workspace, interests: unknown, dislikes: unknown, limit = 5): MajorSuggestion[] {
  const likes = clean(interests);
  const avoid = new Set(clean(dislikes).filter((k) => !likes.includes(k)));
  const evidence = profileEvidence(ws);
  const total = CAREER.schools.length;
  return CAREER.meta.majors
    .filter((m) => TAGS[m.key] && breadth(m.key) / total >= BROAD_SHARE)
    .map((m) => {
      const tags = TAGS[m.key];
      const matches = likes.filter((k) => tags.includes(k));
      const avoided = tags.filter((k) => avoid.has(k)).length;
      const found = evidence.filter((e) => PREP[m.key].test(e.search));
      const prep = found.length + found.filter((e) => e.strong).length;
      const readiness: MajorSuggestion["readiness"] = prep >= 3 ? "strong" : prep > 0 ? "some" : "none";
      const note = caution(m.key, m.label, readiness);
      // A competitive major with no preparation yet is a weaker bet, so it ranks a little lower.
      const score = matches.length * 3 - avoided * 3 + Math.min(prep, 4) - (note && readiness === "none" ? 2 : 0);
      return {
        key: m.key, label: m.label, score,
        matches: matches.map((k) => INTERESTS[k]),
        readiness,
        evidence: [...new Set(found.map((e) => e.label))].slice(0, 5),
        offeredAt: `Offered at ${breadth(m.key)} of the ${total} colleges in Forge's data`,
        ...(note ? { caution: note } : {}),
      };
    })
    .filter((s) => (likes.length ? s.matches.length > 0 : true) && s.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}
