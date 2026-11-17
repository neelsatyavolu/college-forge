import { CliError } from "./errors";

/** One application as Forge's MCP tools return it (lib/mcp-tools.ts `brief`). Never holds a password. */
export interface School {
  school: string;
  id: string;
  status: string;
  status_label: string;
  round: string | null;
  deadline: string | null;
  decision_date: string | null;
  next: string | null;
  decision: string;
  portal: { checked_at: string; ok: boolean; says: string | null; error: string | null; missing_items: string[]; last_check_failed: string | null } | null;
  submitted: string | null;
  follow_ups: { id: string; text: string; due: string | null }[];
  portal_link: string | null;
  portal_login_saved: boolean;
  notes: string | null;
  decision_note?: string | null;
}

export type Login = { username: string; password: string; portalUrl: string };

/** Forge says a decision is posted but unopened; only that it arrived is printed, never what it is. */
const unopened = (s: School) => s.decision.startsWith("A decision is posted");

/** One school by its id, exact name, or a part of its name that only one school has. */
export function findSchool(list: School[], query: string): School {
  const q = query.trim().toLowerCase();
  const exact = list.find((s) => s.id === query || s.school.toLowerCase() === q);
  if (exact) return exact;
  const partial = list.filter((s) => s.school.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) throw new CliError(`No school matches "${query}". Run: collegeforge list`);
  throw new CliError(`"${query}" matches more than one school:\n${partial.map((s) => `  ${s.school} (${s.id})`).join("\n")}`);
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd()).join("\n");
}

function portalLine(s: School): string {
  if (unopened(s)) return "Decision received";
  if (!s.portal) return "";
  if (!s.portal.ok) return `check failed: ${s.portal.error ?? ""}`;
  return [s.portal.says ?? "", s.portal.missing_items.length ? `missing: ${s.portal.missing_items.join(", ")}` : ""].filter(Boolean).join("; ");
}

export function listText(list: School[]): string {
  if (list.length === 0) return "No schools yet. Add them in Forge.";
  const rows = [...list].sort((a, b) => a.school.localeCompare(b.school)).map((s) => [s.school, s.status_label, s.round ?? "", s.next ?? "", portalLine(s)]);
  return table([["SCHOOL", "STATUS", "ROUND", "NEXT", "PORTAL"], ...rows]);
}

export function detailText(s: School): string {
  const p = s.portal;
  const lines = [
    s.school,
    `  Status:        ${s.status_label}${s.round ? ` (${s.round})` : ""}`,
    s.deadline && `  Deadline:      ${s.deadline}`,
    s.decision_date && `  Decision date: ${s.decision_date}`,
    s.next && `  Next:          ${s.next}`,
    s.portal_link && `  Portal:        ${s.portal_link}`,
    `  Last checked:  ${p?.checked_at ?? "never"}`,
    unopened(s) ? "  Update:        Decision received" : s.decision !== "none yet" ? `  Decision:      ${s.decision}` : "",
    !unopened(s) && s.decision_note && `  Decision note: ${s.decision_note}`,
    p && !p.ok && `  Last check failed: ${p.error ?? ""}`,
    p?.last_check_failed && `  Last check failed: ${p.last_check_failed}`,
    p?.ok && !unopened(s) && p.says && `  Portal says:   ${p.says}`,
    p?.ok && !unopened(s) && p.missing_items.length > 0 && `  Missing:       ${p.missing_items.join(", ")}`,
    `  Login saved:   ${s.portal_login_saved ? "yes (password: collegeforge creds)" : "no"}`,
    ...s.follow_ups.map((f) => `  Follow-up:     ${f.text}${f.due ? ` (by ${f.due})` : ""}`),
    s.notes && `  Notes:\n${s.notes.replace(/^/gm, "    ")}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function credsText(s: School, login: Login | undefined): string {
  if (!login) return `${s.school}: no saved login.`;
  return [s.school, `  ${login.portalUrl || s.portal_link || ""}`, `    username: ${login.username}`, `    password: ${login.password}`].join("\n");
}
