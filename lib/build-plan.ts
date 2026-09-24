/**
 * Split the AI hub build into small chat requests. One request cannot
 * research a whole college list: providers cap tool rounds per request
 * (6 for ChatGPT) and the model makes only a couple of calls per round.
 * So each step covers a few schools, and a final step balances the
 * application rounds across the list and sets milestones around them.
 */

import type { Workspace } from "./store";
import { planReadiness } from "./plan-readiness";

export const SCHOOLS_PER_STEP = 2;

export type BuildStep = { label: string; prompt: string };
export type BuildPlan = { schools: BuildStep[]; milestones: BuildStep };

const SCHOOL_INSTRUCTIONS = `For each school, run one web_search on its official admissions site that covers both its deadlines and its supplemental essays. Issue both schools' calls together in the same turn.

1. **Deadlines** (when listed as needed): save this cycle's official deadlines with upsert_college (the school's name + slug above) as \`deadlines: [{plan, date: "YYYY-MM-DD"}]\`, plus \`supp\` (No supps / Supps optional / Supps required).
   - Name admission rounds exactly: "ED I", "ED II", "EA", "EA II", "REA", "RD", "Priority", or "Rolling".
   - Name every other deadline by its type first: "Financial aid", "Scholarship", "Honors", or "Documents", adding the round in parentheses when it applies to only one, e.g. "Financial aid (ED I)" or "Documents (EA)".
   - Do not set the \`deadline\` label; the round is chosen later across the whole list. Leave out any date you cannot verify.
2. **Supplement prompts** (when listed as needed): check the official site for this cycle's prompts.
   - Released → set_essays with a *partial* supplements map keyed by slug: every prompt with its real word limit, ids \`<slug>-supp-1\`, \`<slug>-supp-2\`… in order (so existing drafts stay attached), and "(optional)" in the label for optional ones.
   - Not released yet → if you find last cycle's prompts, save them the same way with "(last cycle — this year's not released yet)" in each label; otherwise leave the group alone.
   - No supplements → upsert_college with supp "No supps", then set_essays with an empty array for that slug.
3. Do not touch other schools, the profile, or critical dates. Reply in one or two sentences with what you saved and anything you could not verify.

Call tools. Empty fields are better than invented dates or prompts.`;

const PLAN_PROMPT = `Choose the student's application round at each school, then build their dated plan. Each school's deadlines, supplement status, and current round, and the Early Decision choice, are in the workspace snapshot.

1. **Balanced rounds.** Call set_application_rounds once with a round for every school that has deadlines. Spread the work so essays are never rushed:
   - Early Decision only at the school the student chose; none if no Early Decision school is set.
   - Choose EA or Priority only where applying early clearly pays off: merit, scholarship, or honors consideration requires it, admission is rolling or priority-based, or the school needs no new essays.
   - Keep schools with required supplements spread out: at most 3 due in any half month. The first one should be at least 4 weeks from today unless applying early is what earns merit or honors consideration.
   - Everything else goes RD, spread across January and February.
   - The tool reply shows the workload by half month. If any window is overloaded, call it once more with fixes.
2. **Milestones.** Then call set_critical_dates once. Dates the student added are kept automatically, and each school's own deadlines (application, aid, scholarship, honors, documents) already appear on the Timeline, so never repeat them. Only add:
   - FAFSA opening (Oct 1) if it is still ahead
   - one "Target: Ask for recommendation letters" at least 4 weeks before the first chosen deadline (or this week, if that date has passed)
   - a Common App personal statement final draft
   - supplement draft targets staggered one or two schools per week in deadline order, each finished 2 weeks before its deadline
   - one "Target: Submit …" per chosen deadline date, a week before, naming its schools
   Plan only around the chosen rounds, with no "if you choose ED" alternatives. Keep it to about 15 milestones, all dated today or later. Label self-set targets "Target:". Each detail is one short sentence telling the student what to do, with no URLs, sources, or notes about what you left out.
3. Reply in one or two sentences.`;

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

  return { schools, milestones: { label: "Rounds & milestones", prompt: PLAN_PROMPT } };
}
