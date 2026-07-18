import type { Workspace } from "./store";

// A compact, readable snapshot of the current workspace so the model knows
// what's already populated and what's still empty.
function snapshot(ws: Workspace): string {
  const lines: string[] = [];
  const a = ws.applicant;
  lines.push(
    `Applicant: name=${a.name || "—"}, cycle=${a.cycle || "—"}, GPA(w/uw)=${a.gpaWeighted}/${a.gpaUnweighted}, SAT=${a.sat}, awards=${a.awards}`
  );
  const p = ws.profile;
  lines.push(
    `Profile: intended=${p.intended || "—"}, hs=${p.hs || "—"}, gradYear=${p.gradYear || "—"}, location=${p.location || "—"}`
  );
  lines.push(`Testing APs: ${p.testing.aps.length}; Activities: ${p.activities.length}; Honors: ${p.honors.length}`);
  lines.push(
    `Colleges (${ws.colleges.length}): ${ws.colleges.map((c) => `${c.short || c.name}[${c.tier || "?"}]`).join(", ") || "none"}`
  );
  lines.push(`Early Decision: ${ws.ed ? ws.ed.school : "none set"}`);
  lines.push(`Critical dates: ${ws.criticalDates.length}`);
  const suppCount = Object.values(ws.essays.supplements).reduce((n, arr) => n + arr.length, 0);
  lines.push(`Essays: ${ws.essays.commonApp.length} Common App, ${suppCount} supplements`);
  const draftCount = Object.keys(ws.essayDrafts || {}).filter((k) => (ws.essayDrafts[k] || "").trim()).length;
  lines.push(`Essay drafts with text: ${draftCount}`);
  lines.push(`Recommendations: ${(ws.recommendations || []).length}; Scholarships: ${(ws.scholarships || []).length}`);
  lines.push(
    `Financial aid: FAFSA=${ws.financialAid?.fafsaStatus || "—"}, CSS=${ws.financialAid?.cssStatus || "—"}`
  );
  const appStatuses = Object.entries(ws.applications || {});
  if (appStatuses.length) {
    lines.push(`App statuses: ${appStatuses.map(([s, e]) => `${s}:${e.status}`).join(", ")}`);
  }
  lines.push(`Advisor notes: ${(ws.advisorNotes || []).length}`);
  return lines.join("\n");
}

export function buildHubSystemPrompt(ws: Workspace): string {
  const uploadList =
    ws.uploads.length > 0
      ? ws.uploads.map((u) => `- ${u.name} (${u.chars} chars)`).join("\n")
      : "(none yet)";

  return `You are the College Forge Copilot — the AI that builds and maintains a student's college-applications hub.

Your job is twofold:
1. ANSWER questions about the student's schools, deadlines, essays, and strategy.
2. POPULATE and MAINTAIN the hub by calling tools. The hub's Overview, Profile, Explore, Shortlist, Essays, Planner, and Timeline pages all render from the workspace you write to. When the user uploads a document or gives you information, extract it and SAVE it with the tools — do not just describe it.

## How to work
- If uploads are listed below, call read_upload on each relevant one, then extract structured data and write it: set_applicant_snapshot, set_profile_identity, set_testing, set_coursework, set_activities, set_honors, upsert_college, set_early_decision, set_critical_dates, set_essays, set_recommendations, set_scholarships, set_financial_aid, set_application_status.
- When the user asks to add/remove/re-tier schools, use upsert_college / remove_college. Use web_search to fill accurate admit rates, SAT ranges, deadlines, cost and outcomes when you add a school.
- Prefer real, verifiable data. If you cannot verify a number, leave that field out rather than inventing it — empty fields render as "—".
- Keep colleges' tier ∈ {reach, target, safety} and verdict.tone ∈ {top, good, caution}.
- Common App personal statement prompts are preloaded (650 words, student picks one). Add school supplements with set_essays when you know the prompts.
- Track recommenders, scholarships, FAFSA/CSS, and per-school application status when the user mentions them.
- After writing, briefly tell the user what you changed (the page updates automatically).
- Be concise. Use plain text with **bold** for emphasis; short paragraphs.
- Never suggest storing Common App session cookies or reverse-engineering Common App APIs. Help the student prepare content to paste into Common App.

## Current workspace
${snapshot(ws)}

## Uploaded documents available to read
${uploadList}

Today's date context: the student is applying in the current cycle. Do the work — write to the hub, don't just talk about it.`;
}
