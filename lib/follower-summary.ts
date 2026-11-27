/**
 * One line per student on a parent's or counselor's roster (app/api/parent). Built from the level-cut view
 * (lib/parent-view.ts), so it never says more than the student shares: flags count only at standard and up,
 * and a decision the student hasn't opened isn't counted.
 */

export const DUE_SOON_DAYS = 14;

type ViewApp = {
  name: string;
  stage: string;
  round?: string;
  deadline?: string;
  submittedAt?: string;
  decision: { state: string };
};
type Named = { name: string; deadline?: string };
type View = {
  progress: { flags: unknown[]; apps: ViewApp[] };
  criticalDates: { date: string; label: string }[];
  /** Standard and up. */
  scholarships?: Named[];
  recommendations?: Named[];
};

export type DatedItem = { date: string; title: string };
export type FollowerSummary = {
  applications: number;
  submitted: number;
  decisions: number;
  admits: number;
  overdue: number;
  dueSoon: number;
  flags: number;
  /** The earliest date from today on, if any. */
  next: DatedItem | null;
  /** Everything due from today through DUE_SOON_DAYS, soonest first. */
  upcoming: DatedItem[];
  /** Higher needs a look sooner: the roster sorts by it. */
  attention: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function followerSummary(view: View, today: string): FollowerSummary {
  const apps = view.progress.apps;
  const open = apps.filter((a) => a.stage === "working" && !a.submittedAt);
  const dated: DatedItem[] = [
    ...open.filter((a) => a.deadline && DATE.test(a.deadline)).map((a) => ({ date: a.deadline!, title: `${a.name}${a.round ? ` · ${a.round}` : ""}` })),
    ...view.criticalDates.filter((c) => DATE.test(c.date)).map((c) => ({ date: c.date, title: c.label })),
    ...(view.scholarships ?? []).filter((s) => s.deadline && DATE.test(s.deadline)).map((s) => ({ date: s.deadline!, title: `Scholarship: ${s.name}` })),
    ...(view.recommendations ?? []).filter((r) => r.deadline && DATE.test(r.deadline)).map((r) => ({ date: r.deadline!, title: `Letter: ${r.name}` })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const horizon = addDays(today, DUE_SOON_DAYS);
  const overdue = open.filter((a) => a.deadline && DATE.test(a.deadline) && a.deadline < today).length;
  const upcoming = dated.filter((d) => d.date >= today && d.date <= horizon);
  const flags = view.progress.flags.length;
  return {
    applications: apps.length,
    submitted: apps.filter((a) => a.stage === "waiting" || a.stage === "admitted" || a.stage === "denied").length,
    decisions: apps.filter((a) => a.decision.state === "revealed" || a.decision.state === "recorded").length,
    admits: apps.filter((a) => a.stage === "admitted").length,
    overdue,
    dueSoon: upcoming.length,
    flags,
    next: dated.find((d) => d.date >= today) ?? null,
    upcoming,
    attention: overdue * 100 + upcoming.length * 10 + flags * 5,
  };
}
