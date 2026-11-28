/**
 * Deadlines in Forge come from the current admissions cycle (research files, the AI's lookups, the
 * catalog): Nov 1, 2026, Jan 5, 2027 and so on. A student in a later cycle (class of 2028 applies in fall
 * 2027) needs those dates a year on, as provisional estimates until their cycle's dates are published.
 * This moves every stored current-cycle date into the student's cycle when the workspace is read, keeping
 * the original in `projectedFrom`, so it is idempotent and undone if the graduation year changes back.
 */
import type { Workspace } from "./store";
import { CURRENT_CYCLE_START, studentCycle } from "./application-cycle";

/** Years between the current cycle and the student's (0 for this year's seniors). */
export function cycleShift(ws: Workspace): number {
  const c = studentCycle(ws);
  return Math.max(0, c.entryYear - 1 - CURRENT_CYCLE_START);
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The same day `years` later (Feb 29 becomes Feb 28). */
export function shiftIso(date: string, years: number): string {
  const m = ISO.exec(date);
  if (!m || !years) return date;
  const y = Number(m[1]) + years;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const day = m[2] === "02" && m[3] === "29" && !leap ? "28" : m[3];
  return `${y}-${m[2]}-${day}`;
}

/** Inside the current cycle's window (Aug 1 of its first year through Jul 31 of the next). */
export function inCurrentCycle(date: string): boolean {
  return ISO.test(date) && date >= `${CURRENT_CYCLE_START}-08-01` && date <= `${CURRENT_CYCLE_START + 1}-07-31`;
}

type Dated = { date: string; projectedFrom?: string };

/** One date moved into the student's cycle, or back when they're in the current one. */
export function project<T extends Dated>(d: T, shift: number): T {
  if (d.projectedFrom) {
    const want = shift > 0 ? shiftIso(d.projectedFrom, shift) : d.projectedFrom;
    if (shift > 0) return want === d.date ? d : { ...d, date: want };
    const { projectedFrom: _from, ...rest } = d;
    return { ...rest, date: want } as T;
  }
  if (shift > 0 && inCurrentCycle(d.date)) return { ...d, date: shiftIso(d.date, shift), projectedFrom: d.date };
  return d;
}

/** The workspace with every stored current-cycle date in the student's cycle (same object when nothing changes). */
export function withStudentCycleDates(ws: Workspace): Workspace {
  const shift = cycleShift(ws);
  let changed = false;
  const mark = <T>(a: T, b: T): T => { if (a !== b) changed = true; return b; };

  const colleges = ws.colleges.map((c) => {
    if (!c.deadlines?.length) return c;
    const deadlines = c.deadlines.map((d) => mark(d, project(d, shift)));
    return deadlines.some((d, i) => d !== c.deadlines![i]) ? { ...c, deadlines } : c;
  });
  // Milestones the student typed stay exactly as they wrote them.
  const criticalDates = ws.criticalDates.map((d) => (d.source === "student" ? d : mark(d, project(d, shift))));
  const apps = ws.tracker.apps.map((a) => {
    if (!a.deadline) return a;
    const p = project({ date: a.deadline, projectedFrom: a.deadlineProjectedFrom }, shift);
    if (p.date === a.deadline && p.projectedFrom === a.deadlineProjectedFrom) return a;
    changed = true;
    const { deadlineProjectedFrom: _old, ...rest } = a;
    return { ...rest, deadline: p.date, ...(p.projectedFrom ? { deadlineProjectedFrom: p.projectedFrom } : {}) };
  });
  if (!changed) return ws;
  return { ...ws, colleges, criticalDates, tracker: { ...ws.tracker, apps } };
}
