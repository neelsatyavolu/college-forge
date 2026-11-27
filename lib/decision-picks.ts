import { z } from "zod";
import type { ToolSpec } from "./chat-types";
import type { Workspace } from "./store";
import { boardFingerprint, pickableApps } from "./decision-board-inputs";

/**
 * The AI's two best picks among the schools that admitted the student, saved by set_decision_picks.
 * The server checks every id against the workspace, so a pick can only name a real admit.
 * Never recomputed on its own: the student asks for new picks, and the board marks old ones stale.
 */

export const PICK_LIMITS = { headline: 120, why: 600, watchOut: 300, rowLabel: 40, rowCell: 160, summary: 400, rows: 8 } as const;

const line = (max: number, label: string) =>
  z.string({ error: `${label} must be text.` }).trim().max(max, `${label} can be up to ${max} characters.`);

const pickSchema = z.object({
  appId: z.string().min(1).max(80),
  headline: line(PICK_LIMITS.headline, "headline").min(1, "Each pick needs a headline."),
  why: line(PICK_LIMITS.why, "why").min(1, "Each pick needs a why."),
  watchOut: line(PICK_LIMITS.watchOut, "watchOut").default(""),
}).strip();

const rowSchema = z.object({
  label: line(PICK_LIMITS.rowLabel, "row label").min(1),
  a: line(PICK_LIMITS.rowCell, "row cell"),
  b: line(PICK_LIMITS.rowCell, "row cell").default(""),
}).strip();

const savedSchema = z.object({
  picks: z.array(pickSchema).min(1).max(2),
  rows: z.array(rowSchema).max(PICK_LIMITS.rows),
  summary: line(PICK_LIMITS.summary, "summary"),
  fingerprint: z.string().max(64),
  madeAt: z.string().max(40),
});

export type DecisionPick = z.infer<typeof pickSchema>;
export type DecisionPicks = z.infer<typeof savedSchema>;

/** Saved picks read back from a workspace; null when none or no longer valid. */
export function readSavedPicks(raw: unknown): DecisionPicks | null {
  const parsed = savedSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const argsSchema = z.object({
  picks: z.array(pickSchema).min(1, "Give at least one pick.").max(2, "Give at most two picks."),
  rows: z.array(rowSchema).max(PICK_LIMITS.rows, `Keep the comparison to ${PICK_LIMITS.rows} rows.`).default([]),
  summary: line(PICK_LIMITS.summary, "summary").default(""),
});

/** Validates the tool's arguments against this workspace. */
export function picksFromArgs(a: unknown, ws: Workspace, madeAt: string): { ok: true; value: DecisionPicks } | { ok: false; error: string } {
  const parsed = argsSchema.safeParse(a);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message || "Those picks aren't valid." };
  const admitted = pickableApps(ws);
  const want = Math.min(2, admitted.length);
  if (!want) return { ok: false, error: "No school has admitted the student yet, so there is nothing to pick." };
  const { picks, rows, summary } = parsed.data;
  if (picks.length !== want) return { ok: false, error: `Give exactly ${want} pick${want === 1 ? "" : "s"}.` };
  const ids = new Set(admitted.map((app) => app.id));
  const unknown = picks.find((p) => !ids.has(p.appId));
  if (unknown) return { ok: false, error: `"${unknown.appId.slice(0, 80)}" is not a school that admitted the student. Use the ids in the request.` };
  if (new Set(picks.map((p) => p.appId)).size !== picks.length) return { ok: false, error: "The two picks must be different schools." };
  return { ok: true, value: { picks, rows, summary, fingerprint: boardFingerprint(ws), madeAt } };
}

export const DECISION_TOOL_SPECS: ToolSpec[] = [
  {
    name: "set_decision_picks",
    description: "Save the two best schools for the student among those that admitted them (one when only one did), for the Decision board. Use the ids from the request.",
    parameters: {
      type: "object",
      properties: {
        picks: {
          type: "array",
          description: "Best first. Two picks, or one when only one school admitted the student.",
          items: {
            type: "object",
            properties: {
              appId: { type: "string", description: "The school's id from the request." },
              headline: { type: "string", description: `One line, up to ${PICK_LIMITS.headline} characters.` },
              why: { type: "string", description: `Why it fits this student, up to ${PICK_LIMITS.why} characters.` },
              watchOut: { type: "string", description: `The main thing to weigh against it, up to ${PICK_LIMITS.watchOut} characters.` },
            },
            required: ["appId", "headline", "why"],
            additionalProperties: false,
          },
        },
        rows: {
          type: "array",
          description: `Up to ${PICK_LIMITS.rows} side-by-side rows comparing the picks: a is the first pick, b the second.`,
          items: {
            type: "object",
            properties: { label: { type: "string" }, a: { type: "string" }, b: { type: "string" } },
            required: ["label", "a"],
            additionalProperties: false,
          },
        },
        summary: { type: "string", description: `How to decide between them, up to ${PICK_LIMITS.summary} characters.` },
      },
      required: ["picks"],
      additionalProperties: false,
    },
  },
];

type Mutate = (fn: (ws: Workspace) => Workspace) => Promise<Workspace>;

/** Runs set_decision_picks, or returns null for any other tool. */
export async function runDecisionTool(name: string, a: Record<string, unknown>, mutate: Mutate): Promise<string | null> {
  if (name !== "set_decision_picks") return null;
  let reply = "";
  await mutate((ws) => {
    const r = picksFromArgs(a, ws, new Date().toISOString());
    if (!r.ok) throw new Error(r.error);
    reply = `Saved ${r.value.picks.length} pick${r.value.picks.length === 1 ? "" : "s"} for the Decision board.`;
    return { ...ws, decisionBoard: r.value };
  });
  return reply;
}
