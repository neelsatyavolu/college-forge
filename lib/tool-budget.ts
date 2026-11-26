/**
 * A turn's time and round budget. Once a turn has used most of its time (or reached its last round),
 * the next request offers only the tools that finish the turn and tells the model to finish now, so a
 * long research turn still ends with something for the student instead of being cut off by the
 * server's time limit.
 */
import type { ToolSpec } from "./chat-types";

export type WrapUp = {
  /** Milliseconds after the turn starts when the next round should be the final one. */
  afterMs: number;
  /** Tool names still offered in the final round. */
  tools: string[];
  /** What the model is told at the final round. */
  note: string;
  /** Milliseconds after the turn starts by which every request must have finished (inside the server limit). */
  deadlineMs: number;
};

/** How long one request may run: up to `cap`, but never past the turn's deadline. */
export function requestTimeout(wrapUp: WrapUp | undefined, startedAt: number, cap: number, now = Date.now()): number {
  if (!wrapUp) return cap;
  return Math.max(10_000, Math.min(cap, startedAt + wrapUp.deadlineMs - now));
}

/** Whether this round should be the final one. */
export function isFinalRound(wrapUp: WrapUp | undefined, startedAt: number, round: number, maxRounds: number, now = Date.now()): boolean {
  if (!wrapUp) return false;
  return round === maxRounds - 1 || now - startedAt >= wrapUp.afterMs;
}

/** The tools offered in the final round: only the finishing ones. */
export function finalTools(tools: ToolSpec[], wrapUp: WrapUp): ToolSpec[] {
  return tools.filter((t) => wrapUp.tools.includes(t.name));
}

/** Tool outputs longer than this are trimmed for the final round, so the last request stays fast. */
export const FINAL_ROUND_OUTPUT_CHARS = 1_200;

/** A tool output shortened for the final round (the model already read it in full). */
export function trimForFinal(output: string): string {
  return output.length <= FINAL_ROUND_OUTPUT_CHARS ? output : `${output.slice(0, FINAL_ROUND_OUTPUT_CHARS)} …[trimmed; you read the full text earlier]`;
}

/** Onboarding: research must not run past the server's 300-second limit; the list or question must come out. */
export const ONBOARDING_WRAP_UP: WrapUp = {
  afterMs: 100_000,
  deadlineMs: 290_000,
  tools: ["propose_list", "recommend_strategy", "ask_question", "advance_section"],
  note: "Time is nearly up for this turn. Stop researching: with what you already know, call propose_list now (or ask_question if the list step hasn't started). Mark anything unverified as unknown.",
};
