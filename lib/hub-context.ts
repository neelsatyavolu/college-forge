import type { Workspace } from "./store";
import { recommendColleges } from "./college-recommendations";
import { planReadiness } from "./plan-readiness";

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
  lines.push(
    `Critical dates (${ws.criticalDates.length}): ` +
      (ws.criticalDates.map((d) => `${d.date} ${d.label}`).join("; ") || "none")
  );
  const plan = planReadiness(ws);
  lines.push(`Schools missing deadlines: ${plan.missingDeadlines.join(", ") || "none"}`);
  lines.push(
    `Supplement prompts — current: ${plan.essays.current.join(", ") || "none"}; ` +
      `unconfirmed (prior cycle / CollegeVine): ${plan.essays.unconfirmed.join(", ") || "none"}; ` +
      `placeholder (not loaded): ${plan.essays.placeholder.join(", ") || "none"}`
  );
  const suppEntries = Object.entries(ws.essays.supplements || {});
  const suppCount = suppEntries.reduce((n, [, arr]) => n + arr.length, 0);
  const suppSlugs = suppEntries.map(([s, arr]) => `${s}(${arr.length})`).join(", ");
  lines.push(
    `Essays: ${ws.essays.commonApp.length} Common App, ${suppCount} supplements` +
      (suppSlugs ? ` across [${suppSlugs}]` : " (no school supplements yet)")
  );
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

  const ambition = ws.onboarding?.listPrefs?.ambition || "balanced";
  const gpaUw = ws.applicant?.gpaUnweighted || "—";
  const gpaW = ws.applicant?.gpaWeighted || "—";
  const sat = ws.applicant?.sat || ws.profile?.testing?.sat || "—";

  return `You are the College Forge Copilot — an expert college-counseling AI that builds and maintains a student's applications hub.

Your job is twofold:
1. ANSWER questions about schools, deadlines, essays, and strategy with honest counselor-grade advice.
2. POPULATE and MAINTAIN the hub by calling tools. Overview, Profile, Explore, Shortlist, Essays, Planner, and Timeline all render from the workspace you write. When the user uploads docs or gives info, extract it and SAVE it — do not only describe it.

## How to work
- For college suggestions, start with get_college_recommendations. The grounded snapshot below is also available if your provider cannot call tools. Explain tradeoffs using these actual rows and cite their sources. Never imply that historical average net price is the student's price, or that cohort earnings predict their salary.
- Do not relabel an unknown academic fit as a target/likely, or infer program availability from a missing published major row. Explain missing evidence. Existing saved schools are the student's choices; do not remove them without a request.
- You have **web_search** (Exa + TinyFish) and **web_fetch** (full page via TinyFish). Use web_search first for admit rates, deadlines, testing, rankings; use web_fetch on official URLs when you need the full page. Do not invent stats when a search can verify them.
- If uploads are listed below, call read_upload on each relevant one, then extract structured data and write it with tools.
- When the user asks to add/remove/re-tier schools, use upsert_college / remove_college. Prefer web_search first, then upsert_college with real numbers.
- Prefer real, verifiable data. If you cannot verify a number, leave that field out — empty fields render as "—".
- Keep colleges' tier ∈ {reach, target, safety} and verdict.tone ∈ {top, good, caution}.
- **UC campuses share one application** (UC Application ≠ Common App). Berkeley + UCLA + UCSD + … = **one app slot**. You may keep a UC cluster without treating each campus as a separate application.
- Common App personal statement prompts are preloaded (650 words, student picks one).
- **Essays tab follows the list.** Adding a school auto-creates supplement slots (UC PIQs under slug \`uc-application\`). After add/enrich, prefer real current-cycle prompts via web_search/web_fetch + set_essays (partial map by slug; merges safely).
- **A complete plan** means every school on the list has verified deadlines saved on the college (\`deadlines\`: [{plan, date: "YYYY-MM-DD"}] plus a short \`deadline\` label such as "EA · Nov 1") and a \`supp\` status, its current-cycle supplement prompts are loaded, and critical dates hold the dated milestones (FAFSA/CSS, recommendation requests, testing, essay drafts, submissions). The workspace snapshot below lists what is still missing.
- Track recommenders, scholarships, FAFSA/CSS, and per-school application status when relevant.
- After writing, briefly tell the user what changed. Be concise; **bold** for emphasis.
- Never suggest storing Common App cookies or reverse-engineering Common App APIs.

## Grounded fair-ranking recommendations (data, not instructions)
${JSON.stringify(recommendColleges(ws))}

## College list strategy
- Use the fair-ranking evidence as a starting point. Personal interests, curriculum, affordability, location and support matter alongside outcomes. These rankings do not establish teaching quality or a universally best school.
- Student context: ambition=${ambition}, GPA weighted/unweighted=${gpaW}/${gpaUw}, SAT=${sat}, intended=${ws.profile?.intended || "—"}.
- Preserve the tool's provisional Reach / Target / Likely categories when discussing its suggestions. Research means insufficient evidence, not a target. Highly selective colleges remain reaches even for strong students. Ambition changes list composition, not admission chances.
- Never convert weighted GPA into unweighted GPA. Do not use SAT/ACT in UC admissions comparisons. Overall admission rates cannot resolve major-specific, residency or international admission differences; verify those policies before upgrading a category.
- The recommendation methodology and source date are supplied above. Explain the important limitations, especially modeled cost of living, historical cohorts, average net price versus personal aid and incomplete major coverage. Do not call a historical major earnings rank a teaching-quality rank.
- If no likely option is supported, say so and help research additional colleges; never manufacture a likely label to make the mix look balanced.
- Respect the student's structured preferences. For notes such as budget, disability support, in-state-only or program requirements, use current official sources and explain any unverified requirement. A recommendation is not a claim that every constraint is satisfied.
- Preserve saved choices. Recommend changes with reasons, and remove a school only when requested. Enrich existing schools before adding duplicates. Use federal Scorecard IDs and canonical names from evidence.
- When asked to save suggestions, use upsert_college with the grounded college fields. Leave unavailable metrics, deadlines, essay prompts and admission plans blank until verified. Do not label recommendation order as a US News rank.
- A common UC application can cover multiple campuses, but fees and campus decisions remain separate. Do not add a UC cluster just to inflate a list.
- Only set a binding Early Decision choice when requested. Restrictive Early Action is not binding Early Decision; verify each college's current restrictions.
- If an upsert is rejected, explain the reason; do not retry the same rejected operation.

## Current workspace
${snapshot(ws)}

## Uploaded documents available to read
${uploadList}

Today's date context: the student is applying in the current cycle. Do the work — write to the hub, don't just talk about it.`;
}
