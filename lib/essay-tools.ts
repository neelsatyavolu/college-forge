import { z } from "zod";
import type { Essay, EssayStatus, Workspace } from "./store";
import { mergeSupplements } from "./essay-supplements";
import type { Parsed } from "./profile-fields";

/**
 * Reading and writing single essays for the copilot (hub-tools) and MCP agents
 * (mcp-tools), plus validation for the Essays tab's status and suggestion patches.
 */

export const ESSAY_STATUSES = ["draft", "final"] as const;
const MAX_TEXT_CHARS = 20000;
const MAX_KEYS = 500;
const ID = /^[\w.:-]{1,200}$/;

type Located = { essay: Essay; groupKey: string };

/** Every essay prompt with the key of the group it is in ("common" or a college slug). */
function allEssays(ws: Workspace): Located[] {
  const common = ws.essays.commonApp.map((essay) => ({ essay, groupKey: "common" }));
  const supps = Object.entries(ws.essays.supplements || {}).flatMap(([groupKey, list]) =>
    (list || []).map((essay) => ({ essay, groupKey }))
  );
  return [...common, ...supps];
}

export function findEssay(ws: Workspace, id: string): Located | null {
  return allEssays(ws).find((x) => x.essay.id === id) ?? null;
}

function countOf(essay: Essay, text: string): number {
  if (/character/i.test(essay.unit)) return Array.from(text).length;
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** In the Common App choose-one set; prompts saved before chooseGroup existed go by their ca-ps-* id. */
const inCommonSet = (e: Essay) => e.chooseGroup === "common" || (!e.chooseGroup && /^ca-ps-/.test(e.id));

/** Hidden by the student, or one of the Common App prompts they did not choose. Agents skip these. */
export function isEssayHidden(ws: Workspace, essay: Essay): boolean {
  if (ws.essayHidden?.[essay.id]) return true;
  return Boolean(ws.commonAppPrompt && inCommonSet(essay) && essay.id !== ws.commonAppPrompt);
}

/** The visibility flags an agent sees on each essay. */
function visibility(ws: Workspace, essay: Essay) {
  return {
    hidden: isEssayHidden(ws, essay),
    ...(ws.commonAppPrompt && essay.id === ws.commonAppPrompt ? { chosen: true as const } : {}),
  };
}

/** One line per essay for an agent: no draft text, just how far along it is. */
export function essayList(ws: Workspace) {
  return allEssays(ws).map(({ essay, groupKey }) => {
    const count = countOf(essay, ws.essayDrafts[essay.id] || "");
    return {
      id: essay.id,
      school: groupKey,
      group: essay.group ?? null,
      label: essay.label,
      limit: essay.limit,
      unit: essay.unit,
      count,
      status: ws.essayStatus?.[essay.id] ?? (count > 0 ? "draft" : "not started"),
      required: essay.required ?? null,
      ...visibility(ws, essay),
    };
  });
}

/** One essay in full: its prompt, the student's draft, and any suggestion still waiting. */
export function essayView(ws: Workspace, id: string) {
  const found = findEssay(ws, id);
  if (!found) return null;
  const { essay, groupKey } = found;
  const draft = ws.essayDrafts[essay.id] || "";
  const count = countOf(essay, draft);
  return {
    id: essay.id,
    school: groupKey,
    group: essay.group ?? null,
    label: essay.label,
    prompt: essay.prompt,
    limit: essay.limit,
    unit: essay.unit,
    required: essay.required ?? null,
    options: essay.options ?? null,
    choose: essay.choose ?? null,
    choose_group: essay.chooseGroup ?? null,
    audience: essay.audience ?? null,
    draft,
    count,
    over_limit: count > essay.limit,
    status: ws.essayStatus?.[essay.id] ?? (count > 0 ? "draft" : "not started"),
    pending_suggestion: ws.essaySuggestions?.[essay.id]?.text ?? null,
    ...visibility(ws, essay),
  };
}

/** Saves suggested text for the student to use or dismiss on the Essays tab. The draft itself is never changed. */
export function withSuggestion(ws: Workspace, id: string, text: string): Parsed<Workspace> {
  if (!findEssay(ws, id)) return { ok: false, error: `No essay has the id "${id}". Use the ids from list_essays or the Essays tab.` };
  const clean = text.trim();
  if (!clean) return { ok: false, error: "The suggestion is empty." };
  if (clean.length > MAX_TEXT_CHARS) return { ok: false, error: `Suggestions can be at most ${MAX_TEXT_CHARS} characters.` };
  return {
    ok: true,
    value: { ...ws, essaySuggestions: { ...(ws.essaySuggestions || {}), [id]: { text: clean, createdAt: Date.now() } } },
  };
}

const essaySchema = z.object({
  id: z.string().regex(ID, "Use letters, numbers, dashes or underscores for ids."),
  label: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(4000),
  limit: z.number().int().min(1).max(50000),
  unit: z.enum(["words", "characters"]),
  required: z.boolean().optional(),
  chooseGroup: z.string().max(80).optional(),
  choose: z.number().int().min(0).max(20).optional(),
  options: z.array(z.string().max(2000)).max(20).optional(),
  audience: z.string().max(200).optional(),
}).strip();
const essayListSchema = z.array(essaySchema).max(40);
export const essayPromptsSchema = z.object({
  commonApp: essayListSchema.optional(),
  supplements: z.record(z.string().regex(ID), essayListSchema).optional(),
});
export type EssayPrompts = z.infer<typeof essayPromptsSchema>;

/**
 * Replaces the Common App prompts and/or the listed schools' supplements. An empty
 * list removes that school's group. Drafts are keyed by id, so keeping ids keeps drafts.
 */
export function withEssayPrompts(ws: Workspace, prompts: EssayPrompts): Workspace {
  // Codex fills optional numbers with 0, strings with "" and lists with []: all mean absent.
  const clean = (list: Essay[]) => list.map(({ chooseGroup, choose, audience, options, ...e }) => ({
    ...e,
    ...(chooseGroup ? { chooseGroup } : {}),
    ...(choose ? { choose } : {}),
    ...(audience ? { audience } : {}),
    ...(options?.length ? { options } : {}),
  }));
  return {
    ...ws,
    essays: {
      commonApp: prompts.commonApp?.length ? clean(prompts.commonApp) : ws.essays.commonApp,
      supplements: prompts.supplements
        ? mergeSupplements(ws.essays.supplements, Object.fromEntries(Object.entries(prompts.supplements).map(([k, v]) => [k, clean(v)])))
        : ws.essays.supplements,
    },
  };
}

function idMap(raw: unknown, name: string): Parsed<Record<string, unknown>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `${name} must be an object keyed by essay id.` };
  const entries = Object.entries(raw);
  if (entries.length > MAX_KEYS) return { ok: false, error: `${name} has too many entries.` };
  if (entries.some(([k]) => !ID.test(k))) return { ok: false, error: `${name} has an invalid essay id.` };
  return { ok: true, value: raw as Record<string, unknown> };
}

/** essayStatus patch: { id: "draft" | "final" | null }, where null clears the mark. */
export function checkEssayStatus(raw: unknown): Parsed<Record<string, EssayStatus | null>> {
  const map = idMap(raw, "essayStatus");
  if (!map.ok) return map;
  const bad = Object.values(map.value).some((v) => v !== null && !(ESSAY_STATUSES as readonly unknown[]).includes(v));
  if (bad) return { ok: false, error: "An essay status must be draft or final." };
  return { ok: true, value: map.value as Record<string, EssayStatus | null> };
}

/** essaySuggestions patch from the Essays tab: { id: null } dismisses a suggestion. Only the copilot adds them. */
export function checkEssaySuggestionDismissals(raw: unknown): Parsed<Record<string, null>> {
  const map = idMap(raw, "essaySuggestions");
  if (!map.ok) return map;
  if (Object.values(map.value).some((v) => v !== null)) return { ok: false, error: "Suggestions can only be dismissed here." };
  return { ok: true, value: map.value as Record<string, null> };
}

function withoutNulls<T>(base: Record<string, T>, patch: Record<string, T | null>): Record<string, T> {
  const merged = { ...base, ...patch };
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== null)) as Record<string, T>;
}

/** essayHidden patch: { id: true | null }, where null shows the essay again. Drafts are never touched. */
export function checkEssayHidden(raw: unknown): Parsed<Record<string, true | null>> {
  const map = idMap(raw, "essayHidden");
  if (!map.ok) return map;
  if (Object.values(map.value).some((v) => v !== true && v !== null)) return { ok: false, error: "essayHidden values must be true or null." };
  return { ok: true, value: map.value as Record<string, true | null> };
}

/** The Common App prompts the student picks one of (the "common" choose set). */
const commonChoices = (ws: Workspace) => ws.essays.commonApp.filter(inCommonSet);

/** commonAppPrompt patch: null clears the choice; otherwise one of the Common App personal statement prompts. */
export function checkCommonAppPrompt(raw: unknown, ws: Workspace): Parsed<string | null> {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string" || !ID.test(raw) || !commonChoices(ws).some((e) => e.id === raw)) {
    return { ok: false, error: "Choose one of the Common App personal essay prompts." };
  }
  return { ok: true, value: raw };
}

export function applyEssayHidden(ws: Workspace, patch: Record<string, true | null>): Workspace {
  return { ...ws, essayHidden: withoutNulls(ws.essayHidden || {}, patch) as Record<string, true> };
}

export function applyCommonAppPrompt(ws: Workspace, id: string | null): Workspace {
  const { commonAppPrompt: _old, ...rest } = ws;
  return id ? { ...rest, commonAppPrompt: id } : rest;
}

/** Clears a saved Common App choice whose prompt no longer exists (the prompts were replaced). */
export function keepValidCommonAppPrompt(ws: Workspace): Workspace {
  if (!ws.commonAppPrompt || commonChoices(ws).some((e) => e.id === ws.commonAppPrompt)) return ws;
  return applyCommonAppPrompt(ws, null);
}

/**
 * The copilot's and MCP agents' way to hide or show essays and to choose (or with null, clear) the Common App
 * prompt, only when the student asks. Ids must be on the Essays tab; nothing else changes, drafts included.
 */
export function withEssayVisibility(
  ws: Workspace,
  input: { hide?: unknown; show?: unknown; commonAppPrompt?: unknown },
): Parsed<Workspace> {
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : []);
  const hide = ids(input.hide);
  const show = ids(input.show);
  if (!hide.length && !show.length && input.commonAppPrompt === undefined) {
    return { ok: false, error: "Nothing to change: pass hide, show or common_app_prompt." };
  }
  const unknown = [...hide, ...show].find((id) => !findEssay(ws, id));
  if (unknown) return { ok: false, error: `No essay has the id "${unknown}". Use list_essays to see the ids.` };
  const patch = Object.fromEntries([...show.map((id) => [id, null]), ...hide.map((id) => [id, true])]) as Record<string, true | null>;
  const checkedHidden = checkEssayHidden(patch);
  if (!checkedHidden.ok) return checkedHidden;
  let next = Object.keys(patch).length ? applyEssayHidden(ws, checkedHidden.value) : ws;
  if (input.commonAppPrompt !== undefined) {
    const choice = checkCommonAppPrompt(input.commonAppPrompt === "" ? null : input.commonAppPrompt, next);
    if (!choice.ok) return choice;
    next = applyCommonAppPrompt(next, choice.value);
  }
  return { ok: true, value: next };
}

export function applyEssayStatus(ws: Workspace, patch: Record<string, EssayStatus | null>): Workspace {
  return { ...ws, essayStatus: withoutNulls(ws.essayStatus || {}, patch) };
}

export function dismissSuggestions(ws: Workspace, patch: Record<string, null>): Workspace {
  return { ...ws, essaySuggestions: withoutNulls(ws.essaySuggestions || {}, patch) };
}
