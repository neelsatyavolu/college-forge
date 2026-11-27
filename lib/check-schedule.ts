/**
 * When automatic portal checks run. A schedule is a frequency (every 8, 12 or 24 hours) and a first check
 * time (a whole hour) in the student's time zone, so "every 8 hours from 7:00" means 7:00, 15:00 and 23:00
 * local time. Checks run in slots: the sweep runs each slot once, a missed slot runs once when the sweep
 * next gets to it, and checking a portal by hand never moves the schedule.
 *
 * Slots keep their local wall-clock hour across daylight saving: an hour skipped by DST runs at the next
 * real hour, and an hour that happens twice runs once (the first time).
 */

export const EVERY_HOURS = [8, 12, 24] as const;
export type EveryHours = (typeof EVERY_HOURS)[number];
export type CheckSchedule = { everyHours: EveryHours; startHour: number; timeZone: string };

export const DEFAULT_TIME_ZONE = "America/Los_Angeles";
export const DEFAULT_SCHEDULE: CheckSchedule = { everyHours: 12, startHour: 7, timeZone: DEFAULT_TIME_ZONE };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Formatters by canonical zone name; there are only a few hundred zones, so this stays small. */
const formatters = new Map<string, Intl.DateTimeFormat>();
const MAX_FORMATTERS = 600;

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  if (formatters.size >= MAX_FORMATTERS) formatters.clear();
  formatters.set(timeZone, f);
  return f;
}

/** The canonical spelling of a zone ("america/new_york" is "America/New_York"), or null if unknown. */
export function canonicalZone(s: unknown): string | null {
  if (typeof s !== "string" || !s || s.length > 64) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: s }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** True for an IANA time zone name this server knows ("America/New_York"). */
export function isTimeZone(s: unknown): s is string {
  return canonicalZone(s) !== null;
}

export const isEveryHours = (v: unknown): v is EveryHours => EVERY_HOURS.includes(v as EveryHours);

/** Whatever was stored, as a valid schedule; anything invalid falls back to the default for that field. */
export function normalizeSchedule(raw: unknown): CheckSchedule {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof CheckSchedule, unknown>>;
  return {
    everyHours: isEveryHours(r.everyHours) ? r.everyHours : DEFAULT_SCHEDULE.everyHours,
    startHour: Number.isInteger(r.startHour) && (r.startHour as number) >= 0 && (r.startHour as number) <= 23 ? (r.startHour as number) : DEFAULT_SCHEDULE.startHour,
    timeZone: canonicalZone(r.timeZone) ?? DEFAULT_SCHEDULE.timeZone,
  };
}

/** The local hours checks run at, earliest first: every 8 hours from 20:00 is [4, 12, 20]. */
export function slotTimes(s: CheckSchedule): number[] {
  const hours: number[] = [];
  for (let h = s.startHour % s.everyHours; h < 24; h += s.everyHours) hours.push(h);
  return hours;
}

type Local = { y: number; m: number; d: number; h: number; min: number };

function localParts(t: number, timeZone: string): Local & { s: number } {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(t))) if (p.type !== "literal") parts[p.type] = Number(p.value);
  return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour % 24, min: parts.minute, s: parts.second };
}

/** Local time minus UTC, in ms, at instant t. */
function offsetAt(t: number, timeZone: string): number {
  const p = localParts(t, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(t / 1000) * 1000;
}

/** The instant a local date and hour starts. A skipped hour gives the next real hour; a repeated one, its first time. */
function instantOf(y: number, m: number, d: number, h: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, h);
  // The offsets a day either side cover both sides of any DST change on this day.
  const candidates = [-DAY_MS, 0, DAY_MS].map((shift) => guess - offsetAt(guess + shift, timeZone));
  const matches = candidates.filter((t) => {
    const p = localParts(t, timeZone);
    return p.d === d && p.h === h && p.min === 0;
  });
  return matches.length ? Math.min(...matches) : Math.max(...candidates);
}

/** Slot instants on the local days around `now` (two days back to two ahead), sorted. */
function slotsAround(s: CheckSchedule, now: number): number[] {
  const today = localParts(now, s.timeZone);
  const out = new Set<number>();
  for (let day = -2; day <= 2; day++) {
    const date = new Date(Date.UTC(today.y, today.m - 1, today.d + day));
    for (const h of slotTimes(s)) out.add(instantOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), h, s.timeZone));
  }
  return [...out].sort((x, y) => x - y);
}

/** The start of the most recent slot at or before `now`. */
export function latestSlot(s: CheckSchedule, now = Date.now()): number {
  const past = slotsAround(s, now).filter((t) => t <= now);
  return past[past.length - 1] ?? now - s.everyHours * HOUR_MS;
}

/** The start of the next slot after `now`. */
export function nextSlot(s: CheckSchedule, now = Date.now()): number {
  return slotsAround(s, now).find((t) => t > now) ?? now + s.everyHours * HOUR_MS;
}

const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** What clients show: the check times ("07:00", "15:00", "23:00") in the schedule's zone, and the next one. */
export function describeSchedule(s: CheckSchedule, now = Date.now()) {
  return { everyHours: s.everyHours, startHour: s.startHour, timeZone: s.timeZone, times: slotTimes(s).map(hhmm), nextAt: nextSlot(s, now) };
}
export type ScheduleView = ReturnType<typeof describeSchedule>;
