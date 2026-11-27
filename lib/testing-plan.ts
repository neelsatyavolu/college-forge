import { actToSat } from "./act-concordance";
import { loadSchoolResearch, type SchoolResearch } from "./school-research";
import type { TrackedApp } from "./tracker";

/**
 * Per-school testing plan: whether to send SAT/ACT scores to a school, how (self-reported or official), and
 * whether the official report has gone out. The recommendation reads only Forge's sourced research facts
 * (test_policy, sat_mid50, act_mid50) and the student's own scores; with no policy on file it says so.
 */

export type PolicyKind = "required" | "optional" | "blind" | "flexible" | "unknown";

export interface TestPolicy {
  kind: PolicyKind;
  /** Whether self-reported scores are accepted; null when the policy doesn't say. */
  selfReport: boolean | null;
  superscore: boolean | null;
  text: string;
  sourceUrl: string;
}

export const TEST_PLANS = ["send", "withhold", "undecided"] as const;
export const TEST_METHODS = ["self_report", "official"] as const;
export type TestPlan = (typeof TEST_PLANS)[number];
export type TestMethod = (typeof TEST_METHODS)[number];

/** What the student decided for one school (stored on TrackedApp.testing). */
export interface TestingChoice {
  plan: TestPlan;
  method?: TestMethod;
  /** yyyy-mm-dd the official College Board/ACT report was ordered. */
  officialSent?: string;
  apSelfReported?: boolean;
}

/** An edit: "" clears method or officialSent. */
export interface TestingEdit {
  plan?: TestPlan;
  method?: TestMethod | "";
  officialSent?: string;
  apSelfReported?: boolean;
}

export type Advice = "send" | "your_call" | "consider_withholding" | "dont_send" | "no_score" | "check_site";

export interface TestingRecommendation {
  advice: Advice;
  label: string;
  reason: string;
  sourceUrl: string;
}

export interface StudentScores {
  sat: number | null;
  act: number | null;
  hasAps: boolean;
}

export interface ScoreRange {
  low: number;
  high: number;
  /** The published median when there is one, otherwise the middle of the range. */
  mid: number;
  median: boolean;
}

// ── Policy text ───────────────────────────────────────────────────────────

/** The policy word the sentence opens with ("Test-optional; ...", "Permanently test-optional", "'No Harm' test-optional"). */
const LEADING = /^\s*(?:(?:permanently|fully)\s+|['‘’"]?no[- ]harm['‘’"]?\s+)?test[- ](required|optional|blind|free|flexible)\b/i;
const LEADING_KIND: Record<string, PolicyKind> = { required: "required", optional: "optional", blind: "blind", free: "blind", flexible: "flexible" };
const REQUIRED = /^\s*(?:(?:the\s+)?(?:SAT|ACT)[^.;]*?\brequired\b|expects\s+(?:an?\s+)?(?:SAT|ACT))/i;
const BLIND = /\btest[- ](?:blind|free)\b|SAT\/ACT (?:scores )?(?:are )?not (?:considered|used)|does not (?:consider|use|accept) (?:the )?SAT/i;
const FLEXIBLE = /^\s*varies by\b|\btest[- ]flexible\b/i;
const OPTIONAL = /\btest[- ]optional\b/i;

const SELF_YES = /self[- ]report(?:ed|ing)?(?:\s+(?:highest|SAT\/ACT|SAT|ACT|or|scores?|test))*\s+(?:are\s+|is\s+)?(?:accepted|allowed|ok|welcome|recommended)|(?:may|can)\s+(?:be\s+)?self[- ]report|self[- ]report(?:ed)?\s+or\s+official|self[- ]report\s+(?:highest|sat|act|in|on|your)|\(self[- ]reported\b|scores\s+(?:are\s+|may\s+be\s+)?self[- ]reported/i;
const SELF_NO = /self[- ]report\w*(?: scores)? (?:are )?not accepted|no self[- ]report|official scores only|only if official|sent officially|sent by (?:the )?testing agency|must be official|official (?:ACT\/SAT |SAT\/ACT |SAT or ACT )?scores?(?: \([^)]*\))? (?:are )?(?:required|due)(?! (?:on|if|after|only if|when) (?:you )?enroll)|, official scores\b/i;
const SUPER_NO = /\bno (?:ACT |SAT )?superscor\w*|\bnot superscored|\(no superscore\)/gi;
const SUPER_YES = /superscor(?:e|es|ed|ing)\b/i;

/** Reads a research test_policy sentence by keywords. Anything it can't place is "unknown". */
export function parsePolicy(text: string | undefined | null, sourceUrl = ""): TestPolicy {
  const t = String(text ?? "").trim();
  const lead = t.match(LEADING);
  const kind: PolicyKind = !t
    ? "unknown"
    : lead
      ? LEADING_KIND[lead[1]!.toLowerCase()]!
      : REQUIRED.test(t)
        ? "required"
        : BLIND.test(t)
          ? "blind"
          : FLEXIBLE.test(t)
            ? "flexible"
            : OPTIONAL.test(t)
              ? "optional"
              : "unknown";
  const selfReport = SELF_YES.test(t) ? true : SELF_NO.test(t) ? false : null;
  const no = t.search(SUPER_NO) >= 0;
  const yes = SUPER_YES.test(t.replace(SUPER_NO, ""));
  const superscore = yes && no ? null : yes ? true : no ? false : null;
  return { kind, selfReport, superscore, text: t, sourceUrl };
}

/** A composite middle-50% range when the fact starts with one ("1480-1560 (...)", "30.5-33", "1420-1510, median 1470") or labels one ("1170-1360 composite"). Section-only ranges don't count. */
export function parseRange(text: string | undefined | null, test: "SAT" | "ACT"): ScoreRange | null {
  const t = String(text ?? "");
  const m = t.match(/^\s*(\d{1,4}(?:\.\d+)?)\s*[-–]\s*(\d{1,4}(?:\.\d+)?)/) ?? t.match(/\b(\d{3,4})\s*[-–]\s*(\d{3,4})\s+composite\b/i);
  if (!m) return null;
  const low = Number(m[1]);
  const high = Number(m[2]);
  const [min, max] = test === "SAT" ? [400, 1600] : [1, 36];
  if (!(low >= min && high <= max && low <= high)) return null;
  const med = String(text).match(/median\s+(\d{1,4}(?:\.\d+)?)/i);
  const median = med ? Number(med[1]) : NaN;
  const hasMedian = median >= low && median <= high;
  return { low, high, mid: hasMedian ? median : (low + high) / 2, median: hasMedian };
}

// ── The student's scores ──────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  return Number(s);
};

/** The student's SAT total, ACT composite and whether they list any AP scores. */
export function studentScores(ws: {
  applicant?: { sat?: string };
  profile?: { testing?: { sat?: string; act?: string; aps?: unknown[] } };
}): StudentScores {
  const t = ws.profile?.testing;
  const sat = num(t?.sat) ?? num(ws.applicant?.sat);
  const act = num(t?.act);
  return {
    sat: sat !== null && sat >= 400 && sat <= 1600 ? sat : null,
    act: act !== null && act >= 1 && act <= 36 ? act : null,
    hasAps: Array.isArray(t?.aps) && t!.aps!.length > 0,
  };
}

// ── Recommendation ───────────────────────────────────────────────────────

type Band = 0 | 1 | 2; // 0 at/above the middle, 1 between the 25th and the middle, 2 below the 25th
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const bandOf = (score: number, r: ScoreRange): Band => (score >= r.mid ? 0 : score >= r.low ? 1 : 2);

interface Comparison {
  band: Band;
  text: string;
}

function compare(scores: StudentScores, sat: ScoreRange | null, act: ScoreRange | null): Comparison | null {
  const out: Comparison[] = [];
  const where = (b: Band, r: ScoreRange) =>
    b === 0 ? `at or above the ${r.median ? "median" : "middle"}` : b === 1 ? `between the 25th percentile and the ${r.median ? "median" : "middle"}` : "below the 25th percentile";
  const range = (label: string, r: ScoreRange) => `${label} middle 50% ${fmt(r.low)}-${fmt(r.high)}`;
  if (scores.sat !== null && sat) {
    const b = bandOf(scores.sat, sat);
    out.push({ band: b, text: `Your SAT ${scores.sat} is ${where(b, sat)} of its ${range("SAT", sat)}.` });
  }
  if (scores.act !== null && act) {
    const b = bandOf(scores.act, act);
    out.push({ band: b, text: `Your ACT ${scores.act} is ${where(b, act)} of its ${range("ACT", act)}.` });
  }
  if (scores.act !== null && !act && sat) {
    const concorded = actToSat(scores.act);
    if (concorded !== null) {
      const b = bandOf(concorded, sat);
      out.push({ band: b, text: `Your ACT ${scores.act} (about ${concorded} SAT) is ${where(b, sat)} of its ${range("SAT", sat)}.` });
    }
  }
  return out.sort((x, y) => x.band - y.band)[0] ?? null;
}

const hasScore = (s: StudentScores) => s.sat !== null || s.act !== null;
/** The policy names applicants or programs with different rules ("required for BA/MD", "for most applicants"). */
const EXCEPTIONS = /\bfor most\b|\bexcept\b|\brequired for\b|\bnot for\b|\brequires? (?:SAT|ACT|scores?)\b[^.;]*\bfor\b|\bonly for some\b|\bvaries\b/i;
/** Scores are considered only when they help the applicant. */
const NO_HARM = /\bno[- ]harm\b|never count against|considered only if (?:they )?(?:help|strengthen)|only if (?:they|it) strengthen/i;
const CAVEAT = " Some applicants or programs follow different rules; read the policy.";

/** What to do with scores at one school, from its policy, its published ranges and the student's scores. */
export function recommend(policy: TestPolicy, satRange: ScoreRange | null, actRange: ScoreRange | null, scores: StudentScores): TestingRecommendation {
  const r = baseRecommendation(policy, satRange, actRange, scores);
  return EXCEPTIONS.test(policy.text) && r.advice !== "check_site" ? { ...r, reason: r.reason + CAVEAT } : r;
}

function baseRecommendation(policy: TestPolicy, satRange: ScoreRange | null, actRange: ScoreRange | null, scores: StudentScores): TestingRecommendation {
  const src = policy.sourceUrl;
  const self = policy.selfReport === true ? " Self-reported scores are accepted." : policy.selfReport === false ? " Official scores from the testing agency are required." : "";
  switch (policy.kind) {
    case "unknown":
      return { advice: "check_site", label: "Check the school's site", reason: policy.text ? "Forge couldn't tell this school's testing policy from its research notes." : "Forge has no testing policy on file for this school.", sourceUrl: src };
    case "flexible":
      return { advice: "check_site", label: "Check the school's site", reason: "The testing policy varies by program or allows other tests; check what your program asks for.", sourceUrl: src };
    case "blind":
      return { advice: "dont_send", label: "Don't send", reason: "Test-blind: SAT and ACT scores aren't considered.", sourceUrl: src };
    case "required":
      return hasScore(scores)
        ? { advice: "send", label: "Send", reason: `Test-required: scores are part of a complete application.${self}`, sourceUrl: src }
        : { advice: "send", label: "Send", reason: "Test-required, and you have no SAT or ACT score on file yet. Plan a test date before the deadline.", sourceUrl: src };
    case "optional": {
      if (!hasScore(scores)) return { advice: "no_score", label: "Apply without scores", reason: "Test-optional, and you have no SAT or ACT score on file.", sourceUrl: src };
      const c = compare(scores, satRange, actRange);
      if (!c) return { advice: "your_call", label: "Your call", reason: "Test-optional, and Forge has no composite score range for this school to compare with.", sourceUrl: src };
      if (c.band === 2 && NO_HARM.test(policy.text)) {
        return { advice: "your_call", label: "Your call", reason: `Test-optional, and the school says scores only count when they help. ${c.text}`, sourceUrl: src };
      }
      const advice: Advice = c.band === 0 ? "send" : c.band === 1 ? "your_call" : "consider_withholding";
      const label = advice === "send" ? "Send" : advice === "your_call" ? "Your call" : "Consider withholding";
      return { advice, label, reason: `Test-optional. ${c.text}${advice === "send" ? self : ""}`, sourceUrl: src };
    }
  }
}

// ── Per application ───────────────────────────────────────────────────────

const fact = (r: SchoolResearch | null, key: string) => r?.facts.find((f) => f.key === key) ?? null;

const researchCache = new Map<string, SchoolResearch | null>();
function researchFor(app: Pick<TrackedApp, "slug" | "name">): SchoolResearch | null {
  const key = `${app.slug ?? ""}|${app.name}`;
  if (!researchCache.has(key)) researchCache.set(key, (app.slug ? loadSchoolResearch(app.slug) : null) ?? loadSchoolResearch(app.name));
  return researchCache.get(key)!;
}

export interface TestingPlanView {
  policy: TestPolicy;
  recommendation: TestingRecommendation;
  choice: TestingChoice;
  hasAps: boolean;
  /** Planned to send official scores but no order recorded: a College Board/ACT order still to place. */
  needsScoreSend: boolean;
}

export function testingPlanFor(app: TrackedApp, scores: StudentScores): TestingPlanView {
  const research = researchFor(app);
  const p = fact(research, "test_policy");
  const policy = parsePolicy(p?.value, p?.sourceUrl ?? "");
  const recommendation = recommend(policy, parseRange(fact(research, "sat_mid50")?.value, "SAT"), parseRange(fact(research, "act_mid50")?.value, "ACT"), scores);
  const choice: TestingChoice = app.testing ?? { plan: "undecided" };
  return {
    policy,
    recommendation,
    choice,
    hasAps: scores.hasAps,
    needsScoreSend: choice.plan === "send" && choice.method === "official" && !choice.officialSent,
  };
}

const isTestItem = (item: string) => /\b(SAT|ACT)\b/.test(item) || /\b(?:SAT\/ACT|standardized test(?:s|ing)?(?: scores?)?)\b/i.test(item);
/**
 * Portal items a school will never receive because the student is withholding SAT/ACT scores there. Only at
 * schools whose policy says scores are optional or not used: a test-required school's missing score stays.
 */
export const withoutWithheldTests = (app: TrackedApp, missing: string[], kind: PolicyKind): string[] =>
  app.testing?.plan === "withhold" && (kind === "optional" || kind === "blind") ? missing.filter((m) => !isTestItem(m)) : missing;

// ── Edits ────────────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => DATE.test(s) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

/** Validates an edit and merges it into the saved choice; throws with a user-facing message. */
export function applyTestingEdit(current: TestingChoice | undefined, edit: unknown): TestingChoice {
  if (!edit || typeof edit !== "object" || Array.isArray(edit)) throw new Error("Testing plan must be an object.");
  const e = edit as Record<string, unknown>;
  if (e.plan !== undefined && !(TEST_PLANS as readonly unknown[]).includes(e.plan)) throw new Error("Testing plan must be send, withhold or undecided.");
  if (e.method !== undefined && e.method !== "" && !(TEST_METHODS as readonly unknown[]).includes(e.method)) throw new Error("Testing method must be self_report, official or empty.");
  if (e.officialSent !== undefined && !(e.officialSent === "" || (typeof e.officialSent === "string" && isRealDate(e.officialSent)))) {
    throw new Error("Testing: the official scores sent date must be yyyy-mm-dd or empty.");
  }
  if (e.apSelfReported !== undefined && typeof e.apSelfReported !== "boolean") throw new Error("Testing: AP self-reported must be true or false.");
  const base: TestingChoice = current ?? { plan: "undecided" };
  const next: TestingChoice = { ...base, ...(e.plan !== undefined ? { plan: e.plan as TestPlan } : {}) };
  const method = e.method !== undefined ? (e.method as TestMethod | "") : next.method;
  const officialSent = e.officialSent !== undefined ? (e.officialSent as string) : next.officialSent;
  const apSelfReported = e.apSelfReported !== undefined ? (e.apSelfReported as boolean) : next.apSelfReported;
  const { method: _m, officialSent: _o, apSelfReported: _a, ...rest } = next;
  return {
    ...rest,
    ...(method ? { method } : {}),
    ...(officialSent ? { officialSent } : {}),
    ...(apSelfReported !== undefined ? { apSelfReported } : {}),
  };
}
