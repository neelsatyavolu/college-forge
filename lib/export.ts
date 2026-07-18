import type { Workspace } from "./store";

function line(s: string): string {
  return s.replace(/\r?\n/g, " ").trim();
}

/** Plain-text pack sized for paste into Common App / counselor email. */
export function exportPlainText(ws: Workspace): string {
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
      `• ${c.name} (${c.tier || "?"}) · ${c.deadline || "deadline TBD"} · status: ${st}` +
        (c.admit ? ` · admit ${c.admit}` : "")
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
    ...ws.essays.commonApp,
    ...Object.entries(ws.essays.supplements).flatMap(([slug, items]) =>
      items.map((e) => ({ ...e, group: e.group || slug }))
    ),
  ];
  for (const e of allEssays) {
    const draft = ws.essayDrafts?.[e.id] || e.starter || "";
    out.push(`\n## ${e.label}`);
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
    lines.push(`### ${tier[0].toUpperCase()}${tier.slice(1)}s`);
    for (const c of group) {
      const st = ws.applications?.[c.slug]?.status || "researching";
      lines.push(`- **${c.short || c.name}** — ${c.deadline || "TBD"} · ${st}${c.admit ? ` · ${c.admit} admit` : ""}`);
    }
  }
  lines.push("");
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
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcsDate(raw: string): string | null {
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw.replace(/-/g, "");
  }
  // "Nov 1" / "Nov 1, 2026" style — approximate current cycle year
  const m = raw.match(/([A-Za-z]{3})\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (!m) return null;
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const mo = months[m[1]];
  if (!mo) return null;
  const day = m[2].padStart(2, "0");
  const year = m[3] || guessCycleYear(mo);
  return `${year}${mo}${day}`;
}

function guessCycleYear(mo: string): string {
  const now = new Date();
  const y = now.getFullYear();
  // Nov–Dec of senior year fall; Jan–Mar of following spring
  if (["01", "02", "03", "04", "05"].includes(mo)) return String(y + (now.getMonth() >= 6 ? 1 : 0));
  return String(now.getMonth() >= 6 ? y : y);
}

/** Calendar (.ics) of deadlines and critical dates. */
export function exportIcs(ws: Workspace): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//College Forge//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:College Forge deadlines",
  ];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const events: { date: string; title: string; detail?: string }[] = [];
  for (const d of ws.criticalDates || []) {
    events.push({ date: d.date, title: d.label, detail: d.detail });
  }
  for (const c of ws.colleges || []) {
    for (const d of c.deadlines || []) {
      events.push({ date: d.date, title: `${c.short || c.name} — ${d.plan}`, detail: c.name });
    }
    if (c.deadline && !c.deadlines?.length) {
      events.push({ date: c.deadline, title: `${c.short || c.name} — application`, detail: c.name });
    }
  }
  for (const s of ws.scholarships || []) {
    if (s.deadline) events.push({ date: s.deadline, title: `Scholarship: ${s.name}`, detail: s.notes });
  }
  for (const r of ws.recommendations || []) {
    if (r.deadline) events.push({ date: r.deadline, title: `Rec letter: ${r.name}`, detail: r.type });
  }

  let i = 0;
  for (const e of events) {
    const dt = toIcsDate(e.date);
    if (!dt) continue;
    i += 1;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:cf-${i}-${dt}@college-forge`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dt}`);
    lines.push(`SUMMARY:${icsEscape(e.title)}`);
    if (e.detail) lines.push(`DESCRIPTION:${icsEscape(e.detail)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
