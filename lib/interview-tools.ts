/**
 * Tools the AI uses to run the onboarding interview. Questions, the draft list and the ED/EA
 * recommendation are drawn by the client from streamed events, and each one ends the AI's turn so
 * the student answers before the AI goes on. Profile answers are saved with the regular profile tools.
 */
import type { ChatEmitter, ToolSpec, UiQuestion, UiSchool, UiStrategy } from "./chat-types";
import type { College, InterviewSection, InterviewState, InterviewTurn, Workspace } from "./store";
import { RESEARCH_KEYS, type ResearchFact, type ResearchKey } from "./school-research";
import { SECTIONS, firstIncomplete, missingFields, startInterview } from "./interview-checklist";
import { isUcCampus } from "./seed-college-list";
import { slugify } from "./colleges";

type Args = Record<string, unknown>;
type Mutate = (fn: (ws: Workspace) => Workspace) => Promise<Workspace>;

export const TRANSCRIPT_CAP = 120;
const KINDS: UiQuestion["kind"][] = ["single", "multi", "upload", "number", "school_search", "confirm"];
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

/** Appends one chat turn (typed or tapped) to the stored transcript, keeping the newest TRANSCRIPT_CAP. */
export function recordTurn(ws: Workspace, turn: InterviewTurn): Workspace {
  const iv = interviewOf(ws);
  return withInterview(ws, { ...iv, transcript: [...iv.transcript, turn].slice(-TRANSCRIPT_CAP) });
}

export function parseQuestion(a: Args): UiQuestion | string {
  const id = text(a.id, 60);
  const prompt = text(a.prompt, 500);
  const kind = KINDS.find((k) => k === a.kind);
  if (!id || !prompt || !kind) return "ask_question needs id, prompt and kind (single | multi | upload | number | school_search | confirm).";
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
    return [{
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

/** Why a proposed list breaks the balance rules, or null when it is acceptable. */
export function checkListProposal(ws: Workspace, schools: UiSchool[]): string | null {
  const apps = applicationCount(schools);
  if (apps < 8 || apps > 15) return `The list has ${apps} applications; propose 8 to 15 (all UC campuses count as one).`;
  const likely = schools.filter((s) => s.tier === "likely");
  const budget = ws.onboarding.listPrefs?.budget;
  const capped = budget && !NO_PRICE_CAP.has(budget);
  const affordable = capped ? likely.filter((s) => s.fitsBudget === "yes") : likely;
  if (affordable.length < 2) {
    return capped
      ? `Only ${affordable.length} likely school${affordable.length === 1 ? "" : "s"} fit the family's budget; include at least 2 (mark fitsBudget "yes" only when the net price is within it).`
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
    if (!key || !value || !sourceUrl || !/^https?:\/\/\S+\.\S+/.test(sourceUrl) || !cycle || !/^\d{4}-\d{2}$/.test(cycle)) return [];
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
      "Show the student one question as tiles and END YOUR TURN. Use it for anything with fixed answers (single/multi choice, confirm), the transcript upload (kind 'upload'), a number (GPA, scores: kind 'number' with min/max) or schools they already like (kind 'school_search'). Write any lead-in sentence before calling it. The student may type instead of tapping.",
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
    description: "Record answers the profile tools don't hold: noActivities ('yes' when they truly have none yet), meritInterest ('yes' | 'no' | 'unsure').",
    parameters: { type: "object", properties: { noActivities: { type: "string", enum: ["yes", "no"] }, meritInterest: { type: "string", enum: ["yes", "no", "unsure"] } }, additionalProperties: false },
  },
  {
    name: "advance_section",
    description: `Move to the next section (${SECTIONS.join(" → ")}), or to 'list' when every section is done. Refused, with what's missing, while earlier sections lack required answers.`,
    parameters: { type: "object", properties: { to: { type: "string", enum: [...SECTIONS, "list"] } }, required: ["to"], additionalProperties: false },
  },
  {
    name: "propose_list",
    description:
      "Show the draft college list as school tiles and END YOUR TURN. 8-15 applications (all UC campuses = 1), mix by the student's ambition, at least 2 likely schools whose net price fits the budget (fitsBudget 'yes' only when you know it does). Each school: name, tier (reach|target|likely), a one-line reason specific to this student, estChance and netPrice when known. Include every school already on their list.",
    parameters: {
      type: "object",
      properties: {
        schools: {
          type: "array",
          items: {
            type: "object",
            properties: { slug: str, name: str, tier: { type: "string", enum: TIERS }, reason: str, estChance: str, netPrice: str, fitsBudget: { type: "string", enum: ["yes", "no", "unknown"] } },
            required: ["name", "tier", "reason"],
            additionalProperties: false,
          },
        },
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

export function makeInterviewTools(mutate: Mutate, read: () => Promise<Workspace>, emit: ChatEmitter): { tools: ToolSpec[]; execute: InterviewExecutor; endTurn: () => boolean; shown: () => unknown } {
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
    switch (name) {
      case "ask_question": {
        const q = parseQuestion(a);
        if (typeof q === "string") return q;
        emit({ type: "question", question: q });
        stop({ question: q });
        return "Shown to the student. Stop now and wait for their answer.";
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
          return withInterview(ws, { ...iv, ...(noActivities !== undefined ? { noActivities } : {}), ...(merit ? { meritInterest: merit } : {}) });
        });
        return "Saved.";
      }
      case "advance_section": {
        let error = "";
        const ws = await mutate((w) => {
          const r = applyAdvance(w, String(a.to ?? ""));
          if ("error" in r) { error = r.error; return w; }
          return r.ws;
        });
        return error || `Now on ${interviewOf(ws).phase === "list" ? "the list" : interviewOf(ws).section}.`;
      }
      case "propose_list": {
        const ws = await read();
        const schools = markCurrent(ws, parseSchools(a.schools));
        const problem = checkListProposal(ws, schools);
        if (problem) return `Not shown: ${problem}`;
        await mutate((w) => withInterview(w, { ...interviewOf(w), phase: "list", listDraft: schools }));
        emit({ type: "list", schools });
        stop({ list: schools });
        return "Shown to the student. Stop now; they will approve, drop or ask for changes.";
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
