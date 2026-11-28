/**
 * Which admissions cycle a student applies in, from their graduation year. A senior graduating in
 * June 2027 applies in fall 2026 (the 2026-27 cycle); a junior graduating in 2028 applies a year later,
 * when every round, ED I included, is still ahead of them and the deadlines aren't published yet.
 */
import type { Workspace } from "./store";

/** The cycle Forge's research describes as current (lib/research-plan.ts CURRENT_CYCLE). */
export const CURRENT_CYCLE_START = 2026;

export type StudentCycle = {
  /** e.g. "2027-28" */
  cycle: string;
  /** The fall they would start college, e.g. 2028. */
  entryYear: number;
  /** True when they apply after the current cycle: no deadline has passed and next cycle's dates aren't out. */
  future: boolean;
};

export function studentCycle(ws: Workspace): StudentCycle {
  const grad = Number(String(ws.profile.gradYear ?? "").trim());
  const entryYear = Number.isInteger(grad) && grad >= 2000 && grad < 2100 ? grad : CURRENT_CYCLE_START + 1;
  const start = entryYear - 1;
  return { cycle: `${start}-${String(entryYear).slice(2)}`, entryYear, future: start > CURRENT_CYCLE_START };
}

/** The prompt's line about timing and early rounds for this student. */
export function cycleGuide(ws: Workspace): string {
  const c = studentCycle(ws);
  if (c.future) {
    return `They graduate in ${c.entryYear} and apply in fall ${c.entryYear - 1} (the ${c.cycle} cycle) for fall ${c.entryYear} entry. No deadline in their cycle has passed: every round, including ED I, EA and REA (usually Nov 1-15) and ED II, is open to them. Their cycle's dates aren't published yet, so use the latest published dates as a guide and call them provisional.`;
  }
  return `They apply in the ${c.cycle} cycle for fall ${c.entryYear} entry. Check today's date: ED I, EA and REA deadlines (usually Nov 1-15) may have passed, so look at ED II (usually early January) and rounds still open.`;
}
