/**
 * Tools the AI uses to run the onboarding interview. Questions, the draft list and the ED/EA
 * recommendation are drawn by the client from streamed events, and each one ends the AI's turn so
 * the student answers before the AI goes on. Profile answers are saved with the regular profile tools.
 */
import type { ChatEmitter, ToolSpec, UiEdIdea, UiQuestion, UiSchool, UiStrategy, UiTransferPath } from "./chat-types";
import { dataTier, REGIONS, schoolPlace, studentAcademics, testRequired } from "./college-recommendations";
import { BUDGET_CAP, studentFacts } from "./list-facts";
import type { College, InterviewSection, InterviewState, InterviewTurn, Workspace } from "./store";
import { RESEARCH_KEYS, type ResearchFact, type ResearchKey } from "./school-research";
import { SECTIONS, firstIncomplete, missingFields, startInterview } from "./interview-checklist";
import { isUcCampus } from "./seed-college-list";
import { isHttpUrl, slugify } from "./colleges";
import { ACTIVITIES, INTERESTS, readAnswers, suggestMajors } from "./major-finder";

type Args = Record<string, unknown>;
type Mutate = (fn: (ws: Workspace) => Workspace) => Promise<Workspace>;

export const TRANSCRIPT_CAP = 120;
const KINDS: UiQuestion["kind"][] = ["single", "multi", "upload", "number", "school_search", "confirm", "activities", "intake"];
const TIERS: UiSchool["tier"][] = ["reach", "target", "likely"];
const NO_PRICE_CAP = new Set(["50plus", "unsure"]);

/** Codex fills unused optional fields with "" or 0: treat both as absent. */
const text = (v: unknown, max = 2000): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : undefined);
const today = () => new Date().toISOString().slice(0, 10);

export function interviewOf(ws: Workspace): InterviewState {
  return ws.onboarding.interview ?? startInterview(Date.now());
}
const withInterview = (ws: Workspace, iv: InterviewState): Workspace => ({ ...ws, onboarding: { ...ws.onboarding, interview: iv } });

const words = (p: string) => new Set(p.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));

/**
 * Drops a paragraph that repeats an earlier one in the same reply. A model sometimes writes its
 * lead-in, saves the answer with a tool, then writes the lead-in again; both reach the student.
 */
export function dedupeParagraphs(text: string): string {
  const kept: { text: string; w: Set<string> }[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const w = words(para);
    const repeat = w.size > 3 && kept.some((k) => {
      const shared = [...w].filter((x) => k.w.has(x)).length;
      return shared / Math.min(w.size, k.w.size) >= 0.7;
    });
    if (!repeat && para.trim()) kept.push({ text: para, w });
  }
  return kept.map((k) => k.text).join("\n\n");
}

/** Appends one chat turn (typed or tapped) to the stored transcript, keeping the newest TRANSCRIPT_CAP. */
export function recordTurn(ws: Workspace, turn: InterviewTurn): Workspace {
  const iv = interviewOf(ws);
  return withInterview(ws, { ...iv, transcript: [...iv.transcript, turn].slice(-TRANSCRIPT_CAP) });
}

export function parseQuestion(a: Args): UiQuestion | string {
  const id = text(a.id, 60);
  const prompt = text(a.prompt, 500);
  const kind = KINDS.find((k) => k === a.kind);
  if (!id || !prompt || !kind) return "ask_question needs id, prompt and kind (single | multi | upload | number | school_search | confirm | activities | intake).";
  const options = Array.isArray(a.options)
    ? a.options.flatMap((o) => {
        const r = (o ?? {}) as Args;
        const label = text(r.label, 80);
        return label ? [{ value: text(r.value, 80) ?? label, label, ...(text(r.hint, 120) ? { hint: text(r.hint, 120) } : {}) }] : [];
      }).slice(0, 12)
    : [];
  if ((kind === "single" || kind === "multi") && options.length < 2) return `A ${kind} question needs at least 2 options.`;
  return {
    id, kind, prompt,
    ...(options.length ? { options } : {}),
    ...(num(a.min) !== undefined ? { min: num(a.min) } : {}),
    ...(num(a.max) !== undefined ? { max: num(a.max) } : {}),
    ...(a.allowOther === true ? { allowOther: true } : {}),
  };
}

/** Moves the interview to a later section, or to the list phase, only when everything before it is answered. */
export function applyAdvance(ws: Workspace, to: string): { ws: Workspace } | { error: string } {
  const iv = interviewOf(ws);
  if (to === "list") {
    const gap = firstIncomplete(ws);
    if (gap) return { error: `Not ready for the list: ${gap} still needs ${missingFields(ws, gap).join(", ")}.` };
    return { ws: withInterview(ws, { ...iv, phase: "list" }) };
  }
  const target = SECTIONS.indexOf(to as InterviewSection);
  if (target < 0) return { error: `Unknown section "${to}". Use one of ${SECTIONS.join(", ")} or "list".` };
  for (const s of SECTIONS.slice(0, target)) {
    const missing = missingFields(ws, s);
    if (missing.length) return { error: `Stay on ${s}: still need ${missing.join(", ")}.` };
  }
  return { ws: withInterview(ws, { ...iv, section: to as InterviewSection }) };
}

export function parseSchools(raw: unknown): UiSchool[] {
  return (Array.isArray(raw) ? raw : []).flatMap((x) => {
    const r = (x ?? {}) as Args;
    const name = text(r.name, 120);
    const tier = TIERS.find((t) => t === r.tier);
    if (!name || !tier) return [];
    const fits = ["yes", "no", "unknown"].find((f) => f === r.fitsBudget) as UiSchool["fitsBudget"];
    const supp = isUcCampus({ name, slug: text(r.slug, 120) }) ? "yes" : (["yes", "no", "unknown"].find((f) => f === r.supplements) as UiSchool["supplements"]);
    return [{
      ...(supp ? { supplements: supp } : {}),
      name, tier, reason: text(r.reason, 280) ?? "",
      ...(text(r.slug, 120) ? { slug: text(r.slug, 120) } : {}),
      ...(text(r.estChance, 40) ? { estChance: text(r.estChance, 40) } : {}),
      ...(text(r.netPrice, 40) ? { netPrice: text(r.netPrice, 40) } : {}),
      ...(fits ? { fitsBudget: fits } : {}),
    }];
  });
}

/** Counts applications: every UC campus together is one. */
export function applicationCount(schools: { name: string; slug?: string }[]): number {
  const uc = schools.some((s) => isUcCampus(s));
  return schools.filter((s) => !isUcCampus(s)).length + (uc ? 1 : 0);
}

/**
 * Replaces each school's tier with Forge's data-based tier when Forge has admissions numbers for it.
 * Returns the adjusted list and a note for the AI naming what changed.
 */
export function applyDataTiers(ws: Workspace, schools: UiSchool[]): { schools: UiSchool[]; changed: string[] } {
  const label = { reach: "reach", target: "target", safety: "likely" } as const;
  const changed: string[] = [];
  const out = schools.map((s) => {
    const t = dataTier(ws, s.name, s.slug);
    if (!t) return s;
    const tier = label[t];
    if (tier === s.tier) return s;
    changed.push(`${s.name} ${s.tier}→${tier}`);
    return { ...s, tier, aiTier: s.tier };
  });
  return { schools: out, changed };
}

/**
 * Public universities rarely give need-based aid to out-of-state students, so for a family with a tight
 * budget that needs aid they usually cost $40-60k a year. A list built on them isn't a real list; at most
 * one in five applications may be an out-of-state public.
 */
export function tooManyNonresidentPublics(ws: Workspace, schools: UiSchool[], apps: number): string | null {
  const prefs = ws.onboarding.listPrefs;
  const cap = prefs?.budget ? BUDGET_CAP[prefs.budget] : null;
  if (!cap || cap > 30_000 || prefs?.needAid === false) return null;
  const names = schools.filter((s) => !isUcCampus(s) && studentFacts(ws, s.name).outOfState).map((s) => s.name);
  const allowed = Math.max(1, Math.floor(apps / 5));
  if (names.length <= allowed) return null;
  return `${names.length} out-of-state public universities (${names.join(", ")}) on a budget under $${cap.toLocaleString("en-US")} with need-based aid: publics rarely give need-based aid to nonresidents, so these usually cost $40,000-60,000 a year. Keep at most ${allowed}; use in-state publics (including regional ones), and private colleges that meet full need or give large merit aid, instead.`;
}

/**
 * Likely schools are the ones a student may actually attend, so they should be where the student said they
 * want to be. With specific regions chosen, at most one likely school may sit outside them. Schools Forge
 * can't place are given the benefit of the doubt.
 */
export function farLikelySchools(ws: Workspace, schools: UiSchool[]): string | null {
  const regions = (ws.onboarding.listPrefs?.regions ?? []).filter((r) => REGIONS[r]);
  if (!regions.length) return null;
  const states = new Set(regions.flatMap((r) => REGIONS[r]));
  const far = schools.filter((s) => s.tier === "likely").flatMap((s) => {
    const place = schoolPlace(s.name, s.slug);
    return place && !states.has(place.state) ? [`${s.name} (${place.state})`] : [];
  });
  if (far.length <= 1) return null;
  return `Likely schools outside the regions the student chose (${regions.join(", ")}): ${far.join(", ")}. Keep at most one; pick likely schools they'd be glad to attend where they want to be.`;
}

/** Why a list is too short to show at all: more than two applications short of what the student asked for (never under five). */
/** When `hurried` (the turn is out of time), half the request is enough: a short list with a warning beats no list. */
export function tooShort(ws: Workspace, schools: UiSchool[], hurried = false): string | null {
  const prefs = ws.onboarding.listPrefs;
  const wanted = typeof prefs?.suppCount === "number" && typeof prefs?.noSuppCount === "number" ? prefs.suppCount + prefs.noSuppCount : null;
  const floor = wanted ? Math.max(5, hurried ? Math.ceil(wanted / 2) : wanted - 2) : 5;
  const apps = applicationCount(schools);
  if (apps >= floor) return null;
  return `this list has ${apps} applications${wanted ? ` and the student asked for ${wanted}` : ""}; Forge won't show fewer than ${floor}. Add schools from get_college_recommendations (its "more" and "inState" candidates) or your research, then call propose_list again.`;
}

/** A transfer path the student can act on: both colleges named, and they aren't the same college. */
export function parseTransferPath(raw: Args): UiTransferPath | undefined {
  const college = text(raw.college, 120), transfersTo = text(raw.transfersTo, 120), reason = text(raw.reason, 400);
  if (!college || !transfersTo || !reason) return undefined;
  const base = (name: string) => name.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\b(rn|bsn|to|program|bridge|online)\b/g, " ").replace(/\s+/g, " ").trim();
  if (base(transfersTo).startsWith(base(college)) || base(college).startsWith(base(transfersTo))) return undefined;
  return { college, transfersTo, reason };
}

/** The balance problem in words for the student, shown on a list Forge accepted anyway. */
export function studentWarning(problem: string): string {
  if (/likely schools? fit the family's budget/.test(problem)) return "Heads up: fewer than two likely schools on this list fit your budget. Run each school's net price calculator, and consider adding an in-state public or a community-college transfer path as a backstop.";
  if (/Include at least 2 likely/.test(problem)) return "Heads up: this list has fewer than two likely schools. Add a school you're very likely to get into before you finalize.";
  if (/tiers \(after Forge's data\)/.test(problem)) return `Heads up: the mix doesn't quite match what you chose. ${problem.replace(/^The tiers \(after Forge's data\) are /, "It's ").replace(/ Swap schools to fix .*$/, "")}`;
  if (/SAT or ACT scores, and this student is applying without them/.test(problem)) return `Heads up: ${problem.replace(/, and this student is applying without them\..*$/, "")}. You said you're applying without scores, so confirm each policy or drop them.`;
  if (/Likely schools outside the regions/.test(problem)) return "Heads up: some likely schools here are outside the regions you chose. Swap them for likely schools closer to where you want to be, or tell me if you're open to them.";
  if (/out-of-state public universities/.test(problem)) return "Heads up: several schools here are out-of-state public universities, which rarely give need-based aid to nonresidents. Run each one's net price calculator before counting on it.";
  if (/applications with supplements/.test(problem)) return "Heads up: the number of schools doesn't exactly match the counts you gave. Drop or ask for schools until it does.";
  return `Heads up: ${problem}`;
}

/** Fills each school's net price, budget fit and supplement need from Forge's research files. */
export function applyStudentFacts(ws: Workspace, schools: UiSchool[]): UiSchool[] {
  return schools.map((s) => {
    const f = studentFacts(ws, s.name, s.slug);
    return {
      ...s,
      ...(f.netPrice ? { netPrice: f.netPrice.label } : f.outOfState ? { netPrice: "Out-of-state: check the nonresident cost", fitsBudget: "unknown" as const } : f.international ? { netPrice: "International: check this college's aid for international students", fitsBudget: "unknown" as const } : {}),
      ...(f.fitsBudget ? { fitsBudget: f.fitsBudget } : {}),
      ...(f.supplements && !isUcCampus(s) ? { supplements: f.supplements } : {}),
    };
  });
}

const MIX_SHARES = { ambitious: [0.4, 0.35], balanced: [0.28, 0.42], conservative: [0.15, 0.4] } as const;

/** Why the tier mix doesn't match the student's chosen mix, or null. Tolerance: 2 schools or a quarter of the list. */
export function checkMix(ws: Workspace, schools: UiSchool[]): string | null {
  const ambition = ws.onboarding.listPrefs?.ambition ?? "balanced";
  const [reachShare, targetShare] = MIX_SHARES[ambition] ?? MIX_SHARES.balanced;
  const n = schools.length;
  if (n < 4) return null;
  const count = (t: UiSchool["tier"]) => schools.filter((s) => s.tier === t).length;
  const goal = { reach: Math.round(n * reachShare), target: Math.round(n * targetShare), likely: n - Math.round(n * reachShare) - Math.round(n * targetShare) };
  const slack = Math.max(2, Math.round(n / 4));
  const tiers = needsInternationalAid(ws) ? (["reach", "target"] as const) : (["reach", "target", "likely"] as const);
  const off = tiers.filter((t) => Math.abs(count(t) - goal[t]) > slack && !(t === "target" && needsInternationalAid(ws) && count(t) > goal[t]));
  if (count("reach") === 0 && !(ambition === "conservative" && n < 8)) off.push("reach");
  if (!off.length) return null;
  return `The tiers (after Forge's data) are ${count("reach")} reach / ${count("target")} target / ${count("likely")} likely; a ${ambition} list of ${n} should be about ${goal.reach} / ${goal.target} / ${goal.likely}. Swap schools to fix ${[...new Set(off)].join(" and ")}.`;
}

/** An international student who will apply for aid. */
export function needsInternationalAid(ws: Workspace): boolean {
  const prefs = ws.onboarding.listPrefs;
  return prefs?.citizenship === "international" && prefs?.needAid !== false;
}

/** Why a proposed list breaks the balance rules, or null when it is acceptable. */
export function checkListProposal(ws: Workspace, schools: UiSchool[]): string | null {
  const apps = applicationCount(schools);
  if (studentAcademics(ws).testOptional) {
    const needTests = schools.filter((s) => testRequired(slugify(s.name), s.name)).map((s) => s.name);
    if (needTests.length) return `${needTests.join(", ")} require${needTests.length === 1 ? "s" : ""} SAT or ACT scores, and this student is applying without them. Replace ${needTests.length === 1 ? "it" : "them"} with test-optional or test-blind colleges.`;
  }
  const prefs = ws.onboarding.listPrefs;
  if (typeof prefs?.suppCount === "number" && typeof prefs?.noSuppCount === "number") {
    // Schools whose supplement need is unknown can count either way: the list passes when some split works.
    const yes = applicationCount(schools.filter((s) => s.supplements === "yes" || isUcCampus(s)));
    const no = applicationCount(schools.filter((s) => s.supplements === "no" && !isUcCampus(s)));
    const unknown = applicationCount(schools.filter((s) => s.supplements !== "yes" && s.supplements !== "no" && !isUcCampus(s)));
    const fits = (target: number, sure: number) => sure <= target + 1 && sure + unknown >= target - 1;
    const total = yes + no + unknown;
    if (!fits(prefs.suppCount, yes) || !fits(prefs.noSuppCount, no) || Math.abs(total - (prefs.suppCount + prefs.noSuppCount)) > 2) {
      return `The student asked for ${prefs.suppCount} applications with supplements and ${prefs.noSuppCount} without; this list has ${yes} with, ${no} without and ${unknown} unknown (all UC campuses count as one supplement application). Check the unknown ones' requirements, then adjust.`;
    }
  } else if (apps < 8 || apps > 15) return `The list has ${apps} applications; propose 8 to 15 (all UC campuses count as one).`;
  const nonresident = tooManyNonresidentPublics(ws, schools, apps);
  if (nonresident) return nonresident;
  const far = farLikelySchools(ws, schools);
  if (far) return far;
  // US colleges that fund international students are almost all selective, so their real backups are
  // universities at home or elsewhere abroad (named in the reply), not two likely US schools.
  if (needsInternationalAid(ws)) return null;
  const likely = schools.filter((s) => s.tier === "likely");
  const budget = ws.onboarding.listPrefs?.budget;
  const capped = budget && !NO_PRICE_CAP.has(budget);
  // Unknown costs aren't held against the list; likely schools known to be over budget are.
  const affordable = capped ? likely.filter((s) => s.fitsBudget !== "no") : likely;
  if (affordable.length < 2) {
    return capped
      ? `Only ${affordable.length} likely school${affordable.length === 1 ? "" : "s"} fit the family's budget; the others are over it. Include at least 2 likely schools whose cost could fit.`
      : `Include at least 2 likely schools (now ${likely.length}).`;
  }
  return null;
}

/** Marks schools already on the student's list so the client shows them as kept. */
export function markCurrent(ws: Workspace, schools: UiSchool[]): UiSchool[] {
  const slugs = new Set(ws.colleges.map((c) => c.slug));
  const names = new Set(ws.colleges.map((c) => slugify(c.name)));
  return schools.map((s) => ((s.slug && slugs.has(s.slug)) || names.has(slugify(s.name)) ? { ...s, current: true } : s));
}

function findCollege(ws: Workspace, ref: string): College | undefined {
  const key = slugify(ref);
  return ws.colleges.find((c) => c.slug === ref || c.slug === key || slugify(c.name) === key || slugify(c.short || "") === key);
}

/** Keeps sourced, well-formed facts and merges them into the school's research by key. */
export function mergeResearch(ws: Workspace, a: Args): { ws: Workspace; saved: number; dropped: number; college: College } | { error: string } {
  const ref = text(a.college, 120);
  const college = ref ? findCollege(ws, ref) : undefined;
  if (!college) return { error: `set_school_research: "${ref ?? ""}" is not on the list. Use the slug or name shown in the research prompt.` };
  const raw = Array.isArray(a.facts) ? a.facts : [];
  const facts: ResearchFact[] = raw.flatMap((x) => {
    const r = (x ?? {}) as Args;
    const key = RESEARCH_KEYS.find((k) => k === r.key) as ResearchKey | undefined;
    const value = text(r.value, 600);
    const sourceUrl = text(r.sourceUrl, 600);
    const cycle = text(r.cycle, 10);
    if (!key || !value || !isHttpUrl(sourceUrl) || !cycle || !/^\d{4}-\d{2}$/.test(cycle)) return [];
    const checkedAt = text(r.checkedAt, 10);
    return [{ key, value, sourceUrl, cycle, checkedAt: checkedAt && /^\d{4}-\d{2}-\d{2}$/.test(checkedAt) ? checkedAt : today(), thirdParty: r.thirdParty === true }];
  });
  const prev = college.research;
  const byKey = new Map((prev?.facts ?? []).map((f) => [f.key, f] as const));
  for (const f of facts) byKey.set(f.key, f);
  const research = {
    slug: college.slug, name: college.name, checkedAt: today(),
    complete: a.complete === true, facts: [...byKey.values()],
    deadlines: prev?.deadlines ?? [], supplements: prev?.supplements ?? [],
    ...(prev?.attempts ? { attempts: prev.attempts } : {}),
  };
  const next = { ...ws, colleges: ws.colleges.map((c) => (c.slug === college.slug ? { ...c, research } : c)) };
  return { ws: next, saved: facts.length, dropped: raw.length - facts.length, college };
}

const str = { type: "string" } as const;
export const INTERVIEW_TOOL_SPECS: ToolSpec[] = [
  {
    name: "ask_question",
    description:
      "Show the student one question as tiles and END YOUR TURN. Use it for anything with fixed answers (single/multi choice, confirm), the transcript upload (kind 'upload'), a number (GPA, scores: kind 'number' with min/max) or schools they already like (kind 'school_search'), the quick-start form (kind 'intake': name, school, state, citizenship, GPAs and trend, tests, majors, family income, budget, aid, first-gen, list mix, counts and ED in one place, with options to paste an AI-written summary or upload files), or the editable activities-and-honors list (kind 'activities': the student fills in rows or uploads a resume; saving writes the list to their profile). Write any lead-in sentence before calling it. The student may type instead of tapping.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Short stable id, e.g. 'campus_setting'" },
        kind: { type: "string", enum: KINDS },
        prompt: { type: "string", description: "The question as the student sees it" },
        options: { type: "array", items: { type: "object", properties: { value: str, label: str, hint: str }, required: ["label"], additionalProperties: false } },
        min: { type: "number" }, max: { type: "number" },
        allowOther: { type: "boolean", description: "Offer a 'something else' box" },
      },
      required: ["id", "kind", "prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "suggest_majors",
    description:
      `For an undecided student: ranks broad majors (offered at most colleges) against what they enjoy and would rather avoid, and the courses, AP scores and activities on their profile. Pass tile picks as interest keys and anything they typed, however vague ("i like reading and stuff", "idk, art maybe, not math"), word for word as said: Forge reads it. Each result has the major's label (save that exact label as intended), the interests it matches, readiness (strong | some | none) with the evidence, how many colleges offer it, and a caution where admission to the major is competitive; heard lists the interests Forge took from their answers. Interest keys, each with the activity to show on its tile: ${Object.keys(INTERESTS).map((k) => `${k} ("${ACTIVITIES[k]}"; ${INTERESTS[k]})`).join("; ")}.`,
    parameters: {
      type: "object",
      properties: {
        interests: { type: "array", items: { type: "string", enum: Object.keys(INTERESTS) }, description: "Tiles they picked as enjoyable" },
        dislikes: { type: "array", items: { type: "string", enum: Object.keys(INTERESTS) }, description: "Tiles they picked to avoid" },
        said: { type: "string", description: "Everything they typed about what they like, dislike and their favorite classes, word for word" },
      },
      required: ["interests", "dislikes", "said"],
      additionalProperties: false,
    },
  },
  {
    name: "interview_status",
    description: "Current section, every section's missing required fields, the deeper-answer count and your saved section notes. Call it at the start of each turn you're unsure about.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "save_section_note",
    description: "Save a 1-3 sentence summary of what you learned in a section (context for later turns; the chat only keeps recent messages).",
    parameters: { type: "object", properties: { section: { type: "string", enum: SECTIONS }, note: str }, required: ["section", "note"], additionalProperties: false },
  },
  {
    name: "save_deep_answer",
    description: "Save the student's answer to one deeper question (what drives them, what they'd study and why, what they want from college, a story). Paraphrase faithfully; keep their specifics. Also feeds essay brainstorming.",
    parameters: { type: "object", properties: { prompt: str, answer: str }, required: ["prompt", "answer"], additionalProperties: false },
  },
  {
    name: "set_interview_facts",
    description: "Record answers the profile tools don't hold: noActivities ('yes' when they truly have none yet), meritInterest ('yes' | 'no' | 'unsure'), majorFinder ('declined' when an undecided student doesn't want help finding a major).",
    parameters: { type: "object", properties: { noActivities: { type: "string", enum: ["yes", "no"] }, meritInterest: { type: "string", enum: ["yes", "no", "unsure"] }, majorFinder: { type: "string", enum: ["declined"] } }, additionalProperties: false },
  },
  {
    name: "advance_section",
    description: `Move to the next section (${SECTIONS.join(" → ")}), or to 'list' when every section is done. Refused, with what's missing, while earlier sections lack required answers.`,
    parameters: { type: "object", properties: { to: { type: "string", enum: [...SECTIONS, "list"] } }, required: ["to"], additionalProperties: false },
  },
  {
    name: "propose_list",
    description:
      "Show the draft college list as school tiles and END YOUR TURN. Match the student's counts: suppCount applications with supplemental essays and noSuppCount without (all UC campuses = one supplement application). Mix tiers by their ambition, at least 2 likely schools whose net price fits the budget (fitsBudget 'yes' only when you know it does). Each school: name, tier, supplements (yes/no), a one-line reason specific to this student, estChance and netPrice when known. Forge replaces your tier with its data-based tier where it has admissions numbers. Include every school already on their list, and an edIdea.",
    parameters: {
      type: "object",
      properties: {
        schools: {
          type: "array",
          items: {
            type: "object",
            properties: { slug: str, name: str, tier: { type: "string", enum: TIERS }, reason: str, estChance: str, netPrice: str, fitsBudget: { type: "string", enum: ["yes", "no", "unknown"] }, supplements: { type: "string", enum: ["yes", "no", "unknown"], description: "Does this application need supplemental essays this cycle? UC = yes (PIQs)." } },
            required: ["name", "tier", "reason"],
            additionalProperties: false,
          },
        },
        edIdea: { type: "object", properties: { school: str, reason: str }, required: ["reason"], additionalProperties: false, description: "Your early-round idea for now (an ED school, or why none), confirmed after research." },
        transferPath: { type: "object", properties: { college: str, transfersTo: str, reason: str }, required: ["college", "transfersTo", "reason"], additionalProperties: false, description: "Optional low-cost backstop for tight budgets: a community college near the student and the four-year college its transfer agreement feeds (name the agreement and its GPA/course conditions in reason). Only when you've checked the agreement exists." },
      },
      required: ["schools"],
      additionalProperties: false,
    },
  },
  {
    name: "recommend_strategy",
    description: "After research, recommend an Early Decision school (or none) and Early Action schools, with the trade-offs (ED is binding; compare aid first). Shown with confirm tiles; END YOUR TURN.",
    parameters: { type: "object", properties: { ed: str, ea: { type: "array", items: str }, reasons: str }, required: ["ea", "reasons"], additionalProperties: false },
  },
  {
    name: "set_school_research",
    description:
      "Save verified facts for one school on the list. Each fact: key, a short concrete value, sourceUrl (the page you read), cycle ('2026-27' only when the page describes this cycle), thirdParty (true unless the school's own site, its Common Data Set, or a .gov page), checkedAt (yyyy-mm-dd). Facts without a source are dropped. complete: true only when every key is covered.",
    parameters: {
      type: "object",
      properties: {
        college: { type: "string", description: "slug or name" },
        complete: { type: "boolean" },
        facts: {
          type: "array",
          items: {
            type: "object",
            properties: { key: { type: "string", enum: [...RESEARCH_KEYS] }, value: str, sourceUrl: str, cycle: str, thirdParty: { type: "boolean" }, checkedAt: str },
            required: ["key", "value", "sourceUrl", "cycle", "thirdParty"],
            additionalProperties: false,
          },
        },
      },
      required: ["college", "facts", "complete"],
      additionalProperties: false,
    },
  },
];

function statusOf(ws: Workspace) {
  const iv = interviewOf(ws);
  const missing = Object.fromEntries(SECTIONS.map((s) => [s, missingFields(ws, s)]).filter(([, m]) => (m as string[]).length));
  return { phase: iv.phase, section: iv.section, firstIncomplete: firstIncomplete(ws), missing, deepAnswers: iv.deep.length, notes: iv.notes };
}

/** `execute` returns null for tools it doesn't own, so the caller can fall through to the hub tools. */
export type InterviewExecutor = (name: string, argsJson: string) => Promise<string | null>;

export function makeInterviewTools(
  mutate: Mutate,
  read: () => Promise<Workspace>,
  emit: ChatEmitter,
  /** True once the turn is past its research budget: a list Forge objects to is then shown with its warning rather than sent back for another slow rewrite. */
  hurry: () => boolean = () => false,
): { tools: ToolSpec[]; execute: InterviewExecutor; endTurn: () => boolean; shown: () => unknown } {
  let ended = false;
  let lastUi: unknown;
  const stop = (ui: unknown) => { ended = true; lastUi = ui; };

  const execute: InterviewExecutor = async (name, argsJson) => {
    let a: Args;
    try {
      a = JSON.parse(argsJson || "{}");
    } catch {
      return `Invalid JSON arguments for ${name}.`;
    }
    if (!a || typeof a !== "object" || Array.isArray(a)) return `Invalid JSON object arguments for ${name}.`;
    switch (name) {
      case "ask_question": {
        if (ended) return "You already asked a question this turn. Stop now and wait for the student's answer.";
        const q = parseQuestion(a);
        if (typeof q === "string") return q;
        emit({ type: "question", question: q });
        stop({ question: q });
        return "Shown to the student. Stop now and wait for their answer.";
      }
      case "suggest_majors": {
        const answers = { interests: a.interests, dislikes: a.dislikes, said: a.said };
        const heard = readAnswers(answers);
        const ws = await mutate((w) => withInterview(w, { ...interviewOf(w), majorFinder: "done" }));
        const majors = suggestMajors(ws, answers);
        return majors.length
          ? JSON.stringify({ heard: { likes: heard.likes.map((k) => INTERESTS[k]), dislikes: heard.dislikes.map((k) => INTERESTS[k]) }, majors })
          : "No broad major matches those answers yet. Ask one easy follow-up with examples (what do they do when they have a free day, which class felt least like work), or let them stay Undecided.";
      }
      case "interview_status":
        return JSON.stringify(statusOf(await read()));
      case "save_section_note": {
        const section = SECTIONS.find((s) => s === a.section);
        const note = text(a.note, 800);
        if (!section || !note) return "save_section_note needs a section and a note.";
        await mutate((ws) => { const iv = interviewOf(ws); return withInterview(ws, { ...iv, notes: { ...iv.notes, [section]: note } }); });
        return "Saved.";
      }
      case "save_deep_answer": {
        const prompt = text(a.prompt, 300);
        const answer = text(a.answer, 2000);
        if (!prompt || !answer) return "save_deep_answer needs a prompt and an answer.";
        const ws = await mutate((w) => {
          const iv = interviewOf(w);
          const story = w.onboarding.storyNotes ?? { activities: "", awards: "", other: "" };
          const other = [story.other, `${prompt}\n${answer}`].filter(Boolean).join("\n\n").slice(-8000);
          const interview = { ...iv, deep: [...iv.deep, { prompt, answer }].slice(-12) };
          return { ...w, onboarding: { ...w.onboarding, interview, storyNotes: { ...story, other } } };
        });
        return `Saved (${interviewOf(ws).deep.length} deeper answers).`;
      }
      case "set_interview_facts": {
        const noActivities = a.noActivities === "yes" ? true : a.noActivities === "no" ? false : undefined;
        const merit = ["yes", "no", "unsure"].find((m) => m === a.meritInterest) as InterviewState["meritInterest"];
        await mutate((ws) => {
          const iv = interviewOf(ws);
          return withInterview(ws, { ...iv, ...(noActivities !== undefined ? { noActivities } : {}), ...(merit ? { meritInterest: merit } : {}), ...(a.majorFinder === "declined" ? { majorFinder: "declined" as const } : {}) });
        });
        return "Saved.";
      }
      case "advance_section": {
        let error = "";
        const ws = await mutate((w) => {
          error = "";
          const r = applyAdvance(w, String(a.to ?? ""));
          if ("error" in r) { error = r.error; return w; }
          return r.ws;
        });
        return error || `Now on ${interviewOf(ws).phase === "list" ? "the list" : interviewOf(ws).section}.`;
      }
      case "propose_list": {
        const ws = await read();
        const gap = firstIncomplete(ws);
        if (gap) return `Not shown: finish the interview first (${gap} still needs ${missingFields(ws, gap).join(", ")}).`;
        const { schools: tiered, changed } = applyDataTiers(ws, markCurrent(ws, parseSchools(a.schools)));
        const schools = applyStudentFacts(ws, tiered);
        // A list far short of what the student asked for is never shown, however many tries it takes.
        const short = tooShort(ws, schools, hurry());
        if (short) return `Not shown: ${short}`;
        const problem = checkListProposal(ws, schools) ?? checkMix(ws, schools);
        // Push back twice so the AI can fix the list; some students' situations can't meet every rule
        // (two likely schools under a very tight budget may not exist), so the third try is shown with
        // the problem stated plainly instead of looping.
        const refusals = interviewOf(ws).listRefusals ?? 0;
        if (problem && refusals < 2 && !hurry()) {
          await mutate((w) => withInterview(w, { ...interviewOf(w), listRefusals: refusals + 1 }));
          return `Not shown: ${problem}${changed.length ? ` (Forge's data also sets these tiers: ${changed.join(", ")}.)` : ""} Fix it and call propose_list again; if it truly can't be met for this student, call again anyway and Forge will show the list with this caveat.`;
        }
        const warning = problem ? studentWarning(problem) : undefined;
        const ideaRaw = (a.edIdea ?? {}) as Args;
        const edIdea: UiEdIdea | undefined = text(ideaRaw.reason, 400) ? { ...(text(ideaRaw.school, 120) ? { school: text(ideaRaw.school, 120) } : {}), reason: text(ideaRaw.reason, 400)! } : undefined;
        const pathRaw = (a.transferPath ?? {}) as Args;
        const transferPath = parseTransferPath(pathRaw);
        const extras = { ...(edIdea ? { edIdea } : {}), ...(transferPath ? { transferPath } : {}) };
        await mutate((w) => withInterview(w, { ...interviewOf(w), phase: "list", listDraft: schools, listRefusals: 0, ...extras }));
        emit({ type: "list", schools, ...extras, ...(warning ? { warning } : {}) });
        stop({ list: schools, ...extras, ...(warning ? { warning } : {}) });
        return `Shown to the student${changed.length ? `. Forge set these tiers from its admissions data: ${changed.join(", ")}` : ""}. Stop now; they will approve, drop or ask for changes.`;
      }
      case "recommend_strategy": {
        const reasons = text(a.reasons, 1500);
        if (!reasons) return "recommend_strategy needs reasons.";
        const strategy: UiStrategy = { ...(text(a.ed, 120) ? { ed: text(a.ed, 120) } : {}), ea: (Array.isArray(a.ea) ? a.ea : []).flatMap((s) => (text(s, 120) ? [text(s, 120)!] : [])).slice(0, 10), reasons };
        await mutate((w) => withInterview(w, { ...interviewOf(w), phase: "strategy", strategy: { ...strategy, confirmed: false } }));
        emit({ type: "strategy", strategy });
        stop({ strategy });
        return "Shown to the student. Stop now and wait for them to confirm.";
      }
      case "set_school_research": {
        let result: ReturnType<typeof mergeResearch> = { error: "not run" };
        await mutate((w) => { result = mergeResearch(w, a); return "error" in result ? w : result.ws; });
        const r = result as ReturnType<typeof mergeResearch>;
        if ("error" in r) return r.error;
        emit({ type: "research", slug: r.college.slug, name: r.college.name, stage: a.complete === true ? "done" : "saved", facts: r.saved });
        return `Saved ${r.saved} facts${r.dropped ? `; dropped ${r.dropped} without a valid key, https source or cycle` : ""}.`;
      }
      default:
        return null;
    }
  };
  return { tools: INTERVIEW_TOOL_SPECS, execute, endTurn: () => ended, shown: () => lastUi };
}
