/**
 * Split the AI hub build into small chat requests. One request cannot
 * research a whole college list: providers cap tool rounds per request
 * (6 for ChatGPT) and the model makes only a couple of calls per round.
 * So each step covers a few schools, and a final step sets milestones
 * from the deadlines the earlier steps saved.
 */

import type { Workspace } from "./store";
import { planReadiness } from "./plan-readiness";

export const SCHOOLS_PER_STEP = 2;

export type BuildStep = { label: string; prompt: string };
export type BuildPlan = { schools: BuildStep[]; milestones: BuildStep };

const SCHOOL_INSTRUCTIONS = `For each school, run one web_search on its official admissions site that covers both its deadlines and its supplemental essays. Issue both schools' calls together in the same turn.

1. **Deadlines** (when listed as needed): save this cycle's official deadlines (ED, ED II, EA, REA, RD, plus priority, scholarship, or honors-program deadlines) with upsert_college (the school's name + slug above) as \`deadlines: [{plan, date: "YYYY-MM-DD"}]\`, a short \`deadline\` label for the plan the student is most likely to use (e.g. "EA · Nov 1"), and \`supp\` (No supps / Supps optional / Supps required). Leave out any date you cannot verify.
2. **Supplement prompts** (when listed as needed): check the official site for this cycle's prompts.
   - Released → set_essays with a *partial* supplements map keyed by slug: every prompt with its real word limit, ids \`<slug>-supp-1\`, \`<slug>-supp-2\`… in order (so existing drafts stay attached), and "(optional)" in the label for optional ones.
   - Not released yet → if you find last cycle's prompts, save them the same way with "(last cycle — this year's not released yet)" in each label; otherwise leave the group alone.
   - No supplements → upsert_college with supp "No supps", then set_essays with an empty array for that slug.
3. Do not touch other schools, the profile, or critical dates. Reply in one or two sentences with what you saved and anything you could not verify.

Call tools. Empty fields are better than invented dates or prompts.`;

const MILESTONES_PROMPT = `Build the student's dated application plan. The per-school deadlines are in the workspace snapshot.

Call set_critical_dates once. It replaces the list, so re-include existing critical dates from the snapshot that are still relevant. Include:
- FAFSA opening (Oct 1) and each CSS Profile priority deadline for schools on the list
- recommendation-letter requests about 4 weeks before the earliest deadline
- test registration if the student still plans to test
- Common App personal statement final draft
- supplement draft targets and a "submit by" target about a week before each application deadline
- scholarship deadlines

Label self-set targets "Target:" so they are not mistaken for official deadlines. Do not repeat per-school application deadlines; the Timeline already shows them. Use web_search only for a date you need and cannot find in the snapshot. Reply in one or two sentences.`;

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

export function buildPlan(ws: Workspace): BuildPlan {
  const readiness = planReadiness(ws);
  const missingDeadlines = new Set(readiness.missingDeadlines);
  const essayNeed = new Map<string, string>([
    ...readiness.essays.placeholder.map((slug): [string, string] => [slug, "placeholder"]),
    ...readiness.essays.unconfirmed.map((slug): [string, string] => [slug, "unconfirmed"]),
  ]);

  const todo = ws.colleges.flatMap((c) => {
    const needs = [
      missingDeadlines.has(c.slug) ? "deadlines" : null,
      essayNeed.has(c.slug) ? `supplement prompts (${essayNeed.get(c.slug)})` : null,
    ].filter(Boolean);
    return c.slug && needs.length ? [{ college: c, needs }] : [];
  });

  const schools = chunk(todo, SCHOOLS_PER_STEP).map((batch) => ({
    label: batch.map(({ college }) => college.short || college.name).join(" & "),
    prompt:
      "Research these schools on the student's saved list and save what you find:\n" +
      batch.map(({ college, needs }) => `- ${college.name} [${college.slug}]: ${needs.join(" + ")}`).join("\n") +
      "\n\n" +
      SCHOOL_INSTRUCTIONS,
  }));

  return { schools, milestones: { label: "Milestones", prompt: MILESTONES_PROMPT } };
}
