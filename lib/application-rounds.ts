/**
 * The round a student applies in at each school (EA, RD, …), stored as the
 * college's "EA · Nov 1" label. The Timeline shows only that round's dates.
 */

import type { College, Workspace } from "./store";

export type RoundChoice = { slug: string; plan: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoParts(date: string): { month: number; day: number } | null {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? { month: Number(m[1]) - 1, day: Number(m[2]) } : null;
}

function shortDate(date: string): string {
  const p = isoParts(date);
  return p ? `${MONTHS[p.month]} ${p.day}` : date;
}

export function applyRounds(
  ws: Workspace,
  choices: RoundChoice[]
): { ws: Workspace; saved: string[]; problems: string[] } {
  const labels = new Map<string, string>();
  const problems: string[] = [];
  for (const { slug, plan } of choices) {
    const c = ws.colleges.find((x) => x.slug === slug);
    if (!c) {
      problems.push(`${slug} is not on the list.`);
      continue;
    }
    const deadlines = c.deadlines || [];
    const match = deadlines.find((d) => d.plan.trim().toLowerCase() === String(plan).trim().toLowerCase());
    if (!match) {
      problems.push(`${slug} has no "${plan}" deadline (has: ${deadlines.map((d) => d.plan).join(", ") || "none"}).`);
      continue;
    }
    labels.set(slug, `${match.plan} · ${shortDate(match.date)}`);
  }
  const colleges = ws.colleges.map((c) => (labels.has(c.slug) ? { ...c, deadline: labels.get(c.slug) } : c));
  return { ws: { ...ws, colleges }, saved: [...labels.keys()], problems };
}

function chosenDate(c: College): { month: number; day: number } | null {
  const plan = (c.deadline || "").split("·")[0].trim().toLowerCase();
  const match = plan && (c.deadlines || []).find((d) => d.plan.trim().toLowerCase() === plan);
  return match ? isoParts(match.date) : null;
}

/** Chosen deadlines per half month, so the copilot can spread essay-heavy schools out. */
export function workloadSummary(ws: Workspace): string {
  const buckets = new Map<number, { label: string; schools: College[] }>();
  const unchosen: string[] = [];
  for (const c of ws.colleges) {
    const d = chosenDate(c);
    if (!d) {
      unchosen.push(c.slug);
      continue;
    }
    const late = d.day > 15;
    // Fall months sort before the following spring.
    const key = (d.month >= 6 ? d.month : d.month + 12) * 2 + (late ? 1 : 0);
    const label = `${MONTHS[d.month]} ${late ? "16–end" : "1–15"}`;
    const bucket = buckets.get(key) || { label, schools: [] };
    buckets.set(key, { ...bucket, schools: [...bucket.schools, c] });
  }
  const parts = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, { label, schools }]) => {
      const heavy = schools.filter((c) => c.supp === "Supps required").map((c) => c.short || c.slug);
      const count = `${schools.length} school${schools.length === 1 ? "" : "s"}`;
      return `${label}: ${count}, ${heavy.length} with required supplements${heavy.length ? ` (${heavy.join(", ")})` : ""}`;
    });
  if (unchosen.length) parts.push(`no round chosen: ${unchosen.join(", ")}`);
  return parts.join("; ");
}
