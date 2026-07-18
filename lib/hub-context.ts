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
  const prefs = ws.onboarding?.listPrefs;
  if (prefs) {
    lines.push(
      `List prefs: ambition=${prefs.ambition || "—"}, size=${prefs.size || "any"}, ` +
        `settings=${(prefs.settings || []).join("/") || "any"}, regions=${(prefs.regions || []).join("/") || "any"}`
    );
    if (prefs.notes) lines.push(`List notes: ${prefs.notes.slice(0, 240)}`);
  }
  const story = ws.onboarding?.storyNotes;
  if (story) {
    const bits = [
      story.activities?.trim() ? `activities(${story.activities.trim().length}c)` : null,
      story.awards?.trim() ? `awards(${story.awards.trim().length}c)` : null,
      story.other?.trim() ? `other(${story.other.trim().length}c)` : null,
    ].filter(Boolean);
    if (bits.length) lines.push(`Onboarding story notes: ${bits.join(", ")}`);
  }
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
- You have **web_search** (Exa + TinyFish) and **web_fetch** (full page via TinyFish). Use web_search first for admit rates, deadlines, testing, rankings; use web_fetch on official URLs when you need the full page. Do not invent stats when a search can verify them.
- If uploads are listed below, call read_upload on each relevant one, then extract structured data and write it: set_applicant_snapshot, set_profile_identity, set_testing, set_coursework, set_activities, set_honors, upsert_college, set_early_decision, set_critical_dates, set_essays, set_recommendations, set_scholarships, set_financial_aid, set_application_status.
- When the user asks to add/remove/re-tier schools, use upsert_college / remove_college. Prefer web_search first, then upsert_college with real numbers.
- Prefer real, verifiable data. If you cannot verify a number, leave that field out rather than inventing it — empty fields render as "—".
- Keep colleges' tier ∈ {reach, target, safety} and verdict.tone ∈ {top, good, caution}. Match tiers to the student's actual GPA/SAT — a 3.5 UW student should not have a shortlist of only Ivies.
- **Ambitious ≠ lottery stack.** Ambition means a few major-fit dream reaches (still labeled reach) plus real targets/safeties. For ~3.4–3.6 UW, prefer reaches around ~10–25% admit; at most 1–2 schools under ~8%, only with clear major fit. Do not dump Princeton/MIT/Stanford/Yale/UChicago onto a mid-GPA list unless the student explicitly asks.
- When rebalancing a skewed list (e.g. 13 reaches / 2 safeties), remove ultra-lotteries, re-tier honestly, and add solid targets/safeties — do not only re-label.
- **UC campuses share one application** (the UC Application, separate from Common App). Berkeley + UCLA + UCSD + … still count as **one app slot**. You can add many UCs even when the list is otherwise near a ~20-app ceiling — never refuse extra UCs because of "too many schools." Tag them mentally as one UC Application.
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
