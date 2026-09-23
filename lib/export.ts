import { createHash } from "node:crypto";
import type { Workspace } from "./store";

function line(s: string): string {
  return s.replace(/\r?\n/g, " ").trim();
}

/** Plain-text pack sized for paste into Common App / counselor email. */
export function exportPlainText(ws: Workspace, commonAppEssayId?: string): string {
  const a = ws.applicant;
  const p = ws.profile;
  const out: string[] = [];
  out.push("COLLEGE FORGE — EXPORT");
  out.push("=".repeat(40));
  out.push(`Name: ${a.name || "—"}`);
  out.push(`Cycle: ${a.cycle || "—"} · ${a.year || "—"}`);
  out.push(`High school: ${p.hs || "—"} · Grad: ${p.gradYear || "—"}`);
  out.push(`Location: ${p.location || "—"} · Residency: ${p.residency || "—"}`);
  out.push(`Intended major: ${p.intended || "—"}`);
  out.push(`GPA (W/UW): ${a.gpaWeighted} / ${a.gpaUnweighted}`);
  out.push(`SAT: ${a.sat}${a.satNote ? ` (${a.satNote})` : ""}`);
  out.push(`Counselor: ${p.counselor || "—"}`);
  out.push("");

  out.push("ACTIVITIES (Common App order)");
  out.push("-".repeat(40));
  if (!p.activities.length) out.push("(none)");
  for (const act of [...p.activities].sort((x, y) => x.rank - y.rank)) {
    out.push(`${act.rank}. ${act.name} — ${act.role || ""} (${act.type || ""})`);
    out.push(`   ${act.years || ""} · ${act.hpw || "?"} hr/wk · ${act.wpy || "?"} wk/yr`);
    if (act.desc) out.push(`   ${line(act.desc)}`);
    if (act.bullets?.length) act.bullets.forEach((b) => out.push(`   → ${line(b)}`));
    out.push("");
  }

  out.push("HONORS & AWARDS");
  out.push("-".repeat(40));
  if (!p.honors.length) out.push("(none)");
  for (const h of p.honors) {
    out.push(`• ${h.title} [${h.level}]${h.year ? ` · ${h.year}` : ""}${h.top ? " ★" : ""}`);
  }
  out.push("");

  out.push("SCHOOL LIST");
  out.push("-".repeat(40));
  for (const c of ws.colleges) {
    const st = ws.applications?.[c.slug]?.status || "researching";
    out.push(
      `• ${c.name} (${c.tier === "safety" ? "likely" : c.tier || "not assessed"}) · ${c.deadline || "deadline TBD"} · status: ${st}` +
        (c.admit ? ` · overall admit ${c.admit}` : "")
    );
  }
  if (ws.ed) out.push(`\nEarly Decision (binding): ${ws.ed.school} by ${ws.ed.deadline || "—"}`);
  out.push("");

  out.push("RECOMMENDATIONS");
  out.push("-".repeat(40));
  if (!ws.recommendations?.length) out.push("(none)");
  for (const r of ws.recommendations || []) {
    out.push(`• ${r.name} (${r.type}${r.subject ? ` · ${r.subject}` : ""}) — ${r.status}`);
  }
  out.push("");

  out.push("SCHOLARSHIPS");
  out.push("-".repeat(40));
  if (!ws.scholarships?.length) out.push("(none)");
  for (const s of ws.scholarships || []) {
    out.push(
      `• ${s.name}${s.amount ? ` · ${s.amount}` : ""}${s.deadline ? ` · due ${s.deadline}` : ""} — ${s.status}`
    );
  }
  out.push("");

  const fa = ws.financialAid;
  if (fa) {
    out.push("FINANCIAL AID");
    out.push("-".repeat(40));
    out.push(`FAFSA: ${fa.fafsaStatus || "not started"}`);
    out.push(`CSS Profile: ${fa.cssStatus || "not started"}`);
    if (fa.notes) out.push(fa.notes);
    out.push("");
  }

  out.push("ESSAY DRAFTS");
  out.push("-".repeat(40));
  const allEssays = [
    ...ws.essays.commonApp.filter((essay) => !commonAppEssayId || essay.id === commonAppEssayId),
    ...Object.entries(ws.essays.supplements).flatMap(([slug, items]) =>
      items.map((e) => ({ ...e, group: e.group || slug }))
    ),
  ];
  for (const e of allEssays) {
    const draft = ws.essayDrafts?.[e.id] ?? e.starter ?? "";
    out.push(`\n## ${e.group ? `${e.group} — ` : ""}${e.label}`);
    out.push(`Prompt: ${e.prompt}`);
    out.push(`Limit: ${e.limit} ${e.unit}`);
    out.push(draft.trim() ? draft : "(empty draft)");
  }

  if (ws.advisorNotes?.length) {
    out.push("\n\nADVISOR NOTES");
    out.push("-".repeat(40));
    for (const n of ws.advisorNotes) {
      out.push(`[${n.author || "Advisor"} · ${new Date(n.createdAt).toISOString().slice(0, 10)}]`);
      out.push(n.body);
      out.push("");
    }
  }

  return out.join("\n");
}

/** Counselor one-pager (markdown). */
export function exportCounselorBrief(ws: Workspace): string {
  const a = ws.applicant;
  const p = ws.profile;
  const lines: string[] = [];
  lines.push(`# Counselor brief — ${a.name || "Student"}`);
  lines.push("");
  lines.push(`**Cycle:** ${a.cycle || "—"} · **Year:** ${a.year || "—"}`);
  lines.push(`**School:** ${p.hs || "—"} · Class of ${p.gradYear || "—"}`);
  lines.push(`**Major interest:** ${p.intended || "—"}`);
  lines.push(`**GPA:** W ${a.gpaWeighted} / UW ${a.gpaUnweighted} · **SAT:** ${a.sat}`);
  lines.push(`**Awards tracked:** ${a.awards ?? p.honors.length}`);
  lines.push("");
  if (ws.ed) {
    lines.push(`## Early Decision (binding)`);
    lines.push(`${ws.ed.school} — deadline ${ws.ed.deadline || "—"}`);
    if (ws.ed.reason) lines.push(`_${ws.ed.reason}_`);
    lines.push("");
  }
  lines.push("## List by tier");
  for (const tier of ["reach", "target", "safety"] as const) {
    const group = ws.colleges.filter((c) => c.tier === tier);
    if (!group.length) continue;
    lines.push(`### ${{ reach: "Reaches", target: "Targets", safety: "Likely" }[tier]}`);
    for (const c of group) {
      const st = ws.applications?.[c.slug]?.status || "researching";
      lines.push(`- **${c.short || c.name}** — ${c.deadline || "TBD"} · ${st}${c.admit ? ` · ${c.admit} admit` : ""}`);
    }
  }
  lines.push("");
  const unassessed = ws.colleges.filter((college) => !college.tier);
  if (unassessed.length) {
    lines.push("### Not assessed");
    unassessed.forEach((college) => lines.push(`- **${college.name}** — ${college.deadline || "deadline TBD"}`));
  }
  lines.push("## Top activities");
  for (const act of [...p.activities].sort((x, y) => x.rank - y.rank).slice(0, 5)) {
    lines.push(`${act.rank}. **${act.name}** — ${act.role || ""} (${act.hpw || "?"} hr/wk)`);
    if (act.desc) lines.push(`   ${act.desc}`);
  }
  lines.push("");
  lines.push("## Recommendations");
  for (const r of ws.recommendations || []) {
    lines.push(`- ${r.name} (${r.type}) — **${r.status}**${r.deadline ? ` · due ${r.deadline}` : ""}`);
  }
  if (!ws.recommendations?.length) lines.push("_None tracked yet._");
  lines.push("");
  lines.push("## Financial aid");
  lines.push(`- FAFSA: **${ws.financialAid?.fafsaStatus || "not started"}**`);
  lines.push(`- CSS Profile: **${ws.financialAid?.cssStatus || "not started"}**`);
  lines.push("");
  lines.push("_Generated by College Forge — student may share a live read-only link for updates._");
  return lines.join("\n");
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

function toIcsDate(raw: string, graduationYear: number): string | null {
  const iso = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const named = raw.trim().match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (!iso && !named) return null;
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const monthName = named?.[1].toLowerCase();
  const month = iso ? Number(iso[2]) - 1 : months.findIndex((name) => name === monthName || name.slice(0, 3) === monthName);
  const day = Number(iso ? iso[3] : named![2]);
  const explicitYear = iso ? iso[1] : named![3];
  const year = explicitYear ? Number(explicitYear) : graduationYear ? graduationYear - (month >= 6 ? 1 : 0) : 0;
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || month < 0 || month > 11) return null;
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return `${year}${String(month + 1).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

// RFC 5545: fold content lines at 75 octets without splitting UTF-8 characters.
function foldIcsLine(line: string): string {
  const result: string[] = [];
  let current = "";
  for (const character of line) {
    if (Buffer.byteLength(current + character, "utf8") > 75) {
      result.push(current);
      current = " ";
    }
    current += character;
  }
  result.push(current);
  return result.join("\r\n");
}

/** Calendar content and an explicit count of dates that need correction. */
export function exportCalendar(ws: Workspace): { text: string; included: number; skipped: number } {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//College Forge//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:College Forge deadlines"];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const events: { date: string; title: string; detail?: string }[] = [];
  for (const date of ws.criticalDates || []) events.push({ date: date.date, title: date.label, detail: date.detail });
  for (const college of ws.colleges || []) {
    for (const date of college.deadlines || []) events.push({ date: date.date, title: `${college.short || college.name} — ${date.plan}`, detail: college.name });
    if (college.deadline && !college.deadlines?.length) events.push({ date: college.deadline, title: `${college.short || college.name} — application`, detail: college.name });
  }
  for (const scholarship of ws.scholarships || []) {
    if (scholarship.deadline) events.push({ date: scholarship.deadline, title: `Scholarship: ${scholarship.name}`, detail: scholarship.notes });
  }
  for (const recommendation of ws.recommendations || []) {
    if (recommendation.deadline) events.push({ date: recommendation.deadline, title: `Rec letter: ${recommendation.name}`, detail: recommendation.type });
  }
  const seen = new Set<string>();
  let included = 0;
  let skipped = 0;
  for (const event of events) {
    const date = toIcsDate(event.date, Number(ws.profile.gradYear));
    if (!date) { skipped += 1; continue; }
    const uid = createHash("sha256").update(JSON.stringify([ws.draftStorageKey, date, event.title, event.detail || ""])).digest("hex").slice(0, 32);
    if (seen.has(uid)) continue;
    seen.add(uid);
    included += 1;
    lines.push("BEGIN:VEVENT", `UID:cf-${uid}@college-forge`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${date}`, `SUMMARY:${icsEscape(event.title)}`);
    if (event.detail) lines.push(`DESCRIPTION:${icsEscape(event.detail)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return { text: lines.map(foldIcsLine).join("\r\n") + "\r\n", included, skipped };
}

export function exportIcs(ws: Workspace): string {
  return exportCalendar(ws).text;
}
