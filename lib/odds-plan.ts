/**
 * The AI requests behind "Estimate my chances": one that reads the whole application and saves what it
 * found (set_application_read), then a few schools per request that research each school and save a
 * held-to-the-published-rate estimate (set_admission_odds). Same chunking reason as build-plan.ts:
 * providers cap tool rounds per request.
 */

import type { Workspace } from "./store";
import type { BuildStep } from "./build-plan";
import { baselineFor, boundsFor, chosenRound, knownDecisions, oddsTargets, type OddsTarget } from "./admission-odds";
import { decisionOf, statusInfo } from "./tracker";
import { isEssayHidden, skippedEssayIds } from "./essay-tools";
import { essayGroupKey } from "./essay-supplements";
import { interestOf } from "./interest-log";

export const ODDS_SCHOOLS_PER_STEP = 2;
const ESSAY_CHARS = 24_000;
const MAX_UPLOADS_TO_READ = 3;
const MAX_DECISIONS_LISTED = 20;

export type OddsStep = BuildStep & { keys: string[] };
export type OddsPlan = { read: BuildStep; schools: OddsStep[] };

const PRIVACY = "Write nothing that identifies the student: no names, addresses, phone numbers, emails or ID numbers. Race and ethnicity are not admission factors (US colleges may not consider them since 2023), so leave them out; what the student wrote about their own experiences in essays may count.";

function essayText(ws: Workspace): string {
  const labels = new Map<string, string>();
  for (const e of ws.essays.commonApp) labels.set(e.id, `Common App: ${e.label}`);
  for (const [slug, list] of Object.entries(ws.essays.supplements || {})) for (const e of list) labels.set(e.id, `${slug}: ${e.label}`);
  // Supplements for schools the student turned off are not part of the application.
  const off = skippedEssayIds(ws);
  let left = ESSAY_CHARS;
  const blocks: string[] = [];
  for (const [id, body] of Object.entries(ws.essayDrafts || {})) {
    const t = (body || "").trim();
    if (!t || left <= 0 || off.has(id)) continue;
    const piece = t.slice(0, left);
    left -= piece.length;
    blocks.push(`### ${labels.get(id) || id}\n${piece}`);
  }
  return blocks.join("\n\n");
}

function profileText(ws: Workspace): string {
  const p = ws.profile;
  const a = ws.applicant;
  const lines = [
    `GPA weighted/unweighted: ${a.gpaWeighted}/${a.gpaUnweighted}; SAT: ${a.sat}${a.satNote ? ` (${a.satNote})` : ""}; ACT: ${(p.testing as { act?: string }).act || "—"}`,
    ...(a.gpaByYear && Object.keys(a.gpaByYear).length
      ? [`Unweighted GPA by year: ${(["9", "10", "11", "12"] as const).filter((y) => a.gpaByYear?.[y]).map((y) => `${y}th ${a.gpaByYear![y]}`).join(", ")}${a.gpaTrend ? ` (trend ${a.gpaTrend}${a.gpaRecent ? `; 10th-11th ${a.gpaRecent}` : ""})` : ""}`]
      : a.gpaTrend ? [`Grade trend: ${a.gpaTrend}${a.gpaRecent ? `; 10th-11th GPA ${a.gpaRecent}` : ""}`] : []),
    ...(ws.onboarding?.listPrefs?.firstGen === "yes" ? ["First-generation college student"] : []),
    `Intended: ${p.intended || "—"}; residency: ${p.residency || "—"}; class of ${p.gradYear || "—"}`,
    `AP scores: ${p.testing.aps.map((x) => `${x.course} ${x.score}`).join(", ") || "—"}`,
    `Coursework: APs ${p.coursework.aps.join(", ") || "—"}; honors ${p.coursework.honors.join(", ") || "—"}; senior year ${p.coursework.senior.join(", ") || "—"}`,
    "Activities:",
    ...p.activities.map((x) => `- ${x.name}${x.role ? ` (${x.role})` : ""}${x.years ? `, ${x.years}` : ""}${x.hpw ? `, ${x.hpw} h/wk` : ""}: ${(x.desc || (x.bullets || []).join("; ") || "").slice(0, 300)}`),
    "Honors:",
    ...p.honors.map((h) => `- ${h.title} (${h.level}${h.year ? `, ${h.year}` : ""})`),
  ];
  return lines.join("\n");
}

/** The profile and essay drafts on file, for the read_application tool (kept out of chat messages, which are capped). */
export function applicationMaterial(ws: Workspace): string {
  const uploads = ws.uploads.map((u) => `- ${u.name} (${u.chars} chars)`).join("\n") || "(none)";
  return [
    "## Profile on file",
    profileText(ws),
    "",
    "## Essay drafts on file",
    essayText(ws) || "(none; look for essays in the uploads)",
    "",
    "## Uploads",
    uploads,
  ].join("\n");
}

const DRAFT_CHARS = 2_500;
const wordsIn = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/**
 * One school's part of the application for its estimate: the supplements the student writes for it (hidden and
 * opted-out ones left out), each with status and draft, and their demonstrated-interest log. read_application
 * returns this for a school key, since step prompts are capped at 8,000 characters.
 */
export function schoolMaterial(ws: Workspace, key: string): string {
  const target = oddsTargets(ws).find((t) => t.key === key);
  if (!target) return `No school with key ${key}.`;
  const { college, app } = target;
  const group = essayGroupKey(college) ?? college.slug;
  const essays = (group ? ws.essays.supplements?.[group] || [] : []).filter((e) => !isEssayHidden(ws, e, group || undefined));
  const blocks = essays.map((e) => {
    const draft = (ws.essayDrafts?.[e.id] || "").trim();
    const need = e.required === false ? "optional" : "required";
    const option = e.options?.length && ws.essayOption?.[e.id] !== undefined ? `\nAnswering: ${e.options[ws.essayOption[e.id]] || ""}` : "";
    if (!draft) return `### ${e.label} (${need}): not written yet${option}`;
    const status = ws.essayStatus?.[e.id] === "final" ? "final" : "draft";
    return `### ${e.label} (${need}, ${status}, ${wordsIn(draft)} ${e.unit} of ${e.limit})${option}\nPrompt: ${(e.prompt || "").split(/\n\n/)[0].slice(0, 400)}\n${draft.slice(0, DRAFT_CHARS)}`;
  });
  const interest = app ? interestOf(app).slice(-8).map((i) => `- ${i.kind} ${i.date}${i.who ? ` with ${i.who}` : ""}${i.notes ? `: ${i.notes.slice(0, 200)}` : ""}`) : [];
  return [
    `## ${college.name}: supplements`,
    blocks.join("\n\n") || "(no supplement prompts on file for this school)",
    "",
    "## Demonstrated interest logged",
    interest.join("\n") || "(none logged)",
  ].join("\n");
}

function readStep(): BuildStep {
  return {
    label: "Reading your application",
    prompt: `Read this student's whole application the way an admissions reader would, then save what you found with set_application_read. Do not search the web.

1. Call read_application for the profile, essay drafts and the list of uploads.
2. Call read_upload on up to ${MAX_UPLOADS_TO_READ} uploads that hold the application itself (essays, a profile or application package, a resume or activity list). Skip transcripts and score reports when the profile already has the numbers.
3. Call set_application_read with:
- summary: two or three sentences a reader would say about this applicant.
- academics, activities, essays: a short honest assessment of each (rigor and trend; depth, leadership and impact; voice, specificity and what the essays show).
- context: circumstances a reader weighs, such as first-generation status, family responsibilities, school context, in-state residency, or a recruited, legacy or donor connection when stated.
- strengths and concerns: up to six short items each. Be candid; weak spots help the estimate more than praise.
${PRIVACY}
Reply in one sentence.`,
  };
}

const SCHOOL_INSTRUCTIONS = `Estimate the student's chance of admission at each school. The applicant read ("Application read") and decisions the student already has are in the workspace snapshot; use them, do not reread uploads.

First call read_application with school set to each school's key (both together): it returns the supplements the student is writing for that school, with their drafts and status, and the demonstrated interest they logged. Weigh them as this school's reader would: how specific and convincing the why-this-school and major essays are, required supplements still unwritten, and logged visits or interviews where the school considers interest.

For each school, run at most two web_search calls (issue both schools' calls together), looking for:
- the latest published admission rate for the student's round and residency (Common Data Set section C, the school's class profile), and how the intended major is admitted (some schools admit to competitive or capped majors separately);
- what this school weighs most (CDS C7: rigor, essays, interview, demonstrated interest, recommendations) and any institutional priorities that fit or miss this student.

Then call set_admission_odds once per school, passing its key:
- percent: your estimate. Start from the starting point given and move it for this applicant's actual strengths against what the school weighs. An admit at a more selective school is evidence the application reads well; denials at peer schools are evidence against. Deferrals say little.
- low and high: an honest range. Admissions at selective schools are noisy; keep ranges wide when evidence is thin.
- factors: up to six, each {label, effect: up|down|neutral, detail}.
- sources: the https pages you used. If you found a newer or round-specific rate than the starting point, pass it as published_rate (number) with published_rate_label and its page in sources. Otherwise leave published_rate out; never repeat the starting point as one.
- summary: one or two plain sentences.
The server holds every estimate within a fixed range of the published rate; an estimate outside it is pulled back. Never use race or ethnicity. Reply in one or two sentences with what you saved.`;

/** Targets still worth estimating: no decision known yet (recorded or opened), not withdrawn. */
export function openTargets(ws: Workspace): OddsTarget[] {
  return oddsTargets(ws).filter(({ app }) => {
    if (!app) return true;
    const stage = statusInfo(app.status).stage;
    const d = decisionOf(app).state;
    return (stage === "working" || stage === "waiting") && d !== "recorded" && d !== "revealed";
  });
}

export function oddsPlan(ws: Workspace): OddsPlan {
  const open = openTargets(ws);
  const decided = knownDecisions(ws).slice(0, MAX_DECISIONS_LISTED);
  const schools: OddsStep[] = [];
  for (let i = 0; i < open.length; i += ODDS_SCHOOLS_PER_STEP) {
    const batch = open.slice(i, i + ODDS_SCHOOLS_PER_STEP);
    const lines = batch.map(({ key, college: c, app }) => {
      const base = baselineFor(c, ws, undefined, app);
      const round = chosenRound(c, ws, app) || "round not chosen";
      if (!base) return `- ${c.name} [${key}], ${round}: no admission rate saved; find its published rate and pass it as published_rate.`;
      const { min, max } = boundsFor(base.percent);
      return `- ${c.name} [${key}], ${round}: starting point ${base.percent}% (${base.source}); estimates are held between ${min}% and ${max}%.`;
    });
    schools.push({
      label: batch.map(({ college: c }) => c.short || c.name).join(" & "),
      keys: batch.map((t) => t.key),
      prompt:
        "Estimate admission chances at these schools the student is applying to (the key is in brackets):\n" +
        lines.join("\n") +
        (decided.length ? `\n\nDecisions so far: ${decided.map((d) => `${d.name}${d.round ? ` ${d.round}` : ""}: ${d.outcome}`).join("; ")}.` : "") +
        "\n\n" +
        SCHOOL_INSTRUCTIONS,
    });
  }
  return { read: readStep(), schools };
}
