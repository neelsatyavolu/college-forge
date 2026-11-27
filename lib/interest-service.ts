import { getWorkspace, updateWorkspace, type Workspace } from "./store";
import { findApp, replaceApp, todayIso, type TrackedApp } from "./tracker";
import { TrackerError, researchOf, viewApp, type AppView } from "./tracker-service";
import { studentScores } from "./testing-plan";
import {
  INTEREST_LABELS,
  InterestError,
  addInterest,
  curatedResearchFor,
  interestOf,
  setInterest,
  thankYousOwed,
  upcomingInterviews,
  type InterestInput,
} from "./interest-log";

/**
 * Reads and writes the interest log for the hub API, the copilot and MCP. Errors meant for the student come
 * out as TrackerError, like the rest of the tracker.
 */

function mustFind(ws: Workspace, ref: string): TrackedApp {
  const app = findApp(ws.tracker, ref);
  if (!app) throw new TrackerError(`No application matches "${ref}". Use list_applications to see the schools.`);
  return app;
}

const view = (ws: Workspace, id: string): AppView => {
  const app = ws.tracker.apps.find((a) => a.id === id)!;
  return viewApp(app, todayIso(), studentScores(ws), researchOf(ws.colleges, app));
};

async function change(workspaceId: string, ref: string, fn: (app: TrackedApp) => TrackedApp): Promise<AppView> {
  let id = "";
  try {
    const ws = await updateWorkspace(workspaceId, (current) => {
      const app = mustFind(current, ref);
      id = app.id;
      return { ...current, tracker: replaceApp(current.tracker, fn(app)) };
    });
    return view(ws, id);
  } catch (err) {
    if (err instanceof InterestError) throw new TrackerError(err.message);
    throw err;
  }
}

export const addInterestTo = (workspaceId: string, ref: string, input: InterestInput) =>
  change(workspaceId, ref, (app) => addInterest(app, input, todayIso()));

export const updateInterest = (workspaceId: string, ref: string, eventId: string, edit: InterestInput & { remove?: boolean }) =>
  change(workspaceId, ref, (app) => setInterest(app, eventId, edit));

/** Every school's log and policy, or one school's, plus interviews ahead and thank-you notes owed. */
export async function listInterest(workspaceId: string, ref?: string) {
  const ws = await getWorkspace(workspaceId);
  const today = todayIso();
  const apps = ref ? [mustFind(ws, ref)] : ws.tracker.apps;
  return {
    today,
    schools: apps.map((a) => {
      const v = viewApp(a, today, studentScores(ws), researchOf(ws.colleges, a));
      return { school: a.name, id: a.id, status: v.statusLabel, policy: v.interestSignal, events: v.interest };
    }),
    upcomingInterviews: upcomingInterviews(ws.tracker, today).map(row),
    thankYouOwed: thankYousOwed(ws.tracker).map(row),
  };
}

const row = (r: { appId: string; school: string; event: { id: string; date: string; time?: string; who?: string } }) => ({
  school: r.school, appId: r.appId, eventId: r.event.id, date: r.event.date, time: r.event.time ?? null, who: r.event.who ?? null,
});

const WHY_US = /\bwhy\b|\bwhat (draws|attracts) you\b|\binterest(s|ed)? you\b|\bfit\b/i;
const clip = (s: string | undefined, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * What an assistant needs to draft interview prep, from the student's own material only: the school's sourced
 * facts, their activities and their "why us" drafts. The assistant writes the questions and talking points and
 * saves them with set_interest (prep); nothing here is invented.
 */
export async function interviewPrepBrief(workspaceId: string, ref: string, eventId?: string) {
  const ws = await getWorkspace(workspaceId);
  const app = mustFind(ws, ref);
  const events = interestOf(app).filter((e) => e.kind === "interview");
  const event = eventId ? events.find((e) => e.id === eventId) : events.find((e) => !e.done) ?? events[events.length - 1];
  if (eventId && !event) throw new TrackerError("No interview with that id on this application. Use list_interest for ids.");
  const research = researchOf(ws.colleges, app) ?? curatedResearchFor(app);
  const facts = (research?.facts ?? [])
    .filter((f) => ["interview", "demonstrated_interest", "major_notes", "notes", "ed_ea_options"].includes(f.key))
    .map((f) => ({ key: f.key, value: clip(f.value, 400), source: f.sourceUrl }));
  const slug = app.slug ?? ws.colleges.find((c) => c.name.toLowerCase() === app.name.toLowerCase())?.slug;
  const whyUs = (slug ? ws.essays.supplements[slug] ?? [] : [])
    .filter((e) => WHY_US.test(`${e.label} ${e.prompt}`))
    .map((e) => ({ prompt: clip(e.prompt, 400), draft: clip(ws.essayDrafts[e.id], 2500) }))
    .filter((e) => e.draft);
  const activities = ws.profile.activities.slice(0, 10).map((a) => ({
    name: a.name, role: a.role ?? "", org: a.org ?? "", years: a.years ?? "", about: clip(a.desc || (a.bullets ?? []).join("; "), 300),
  }));
  return {
    school: app.name,
    interview: event ? { id: event.id, kind: INTEREST_LABELS[event.kind], date: event.date, time: event.time ?? null, who: event.who ?? null, prep: event.prep ?? null } : null,
    intended_major: ws.profile.intended || null,
    school_facts: facts,
    activities,
    why_us_drafts: whyUs,
    instructions:
      "Draft 8 likely interview questions for this school, each with 2-3 short talking points drawn only from the student's activities, " +
      "intended major and why-us drafts above. Say what the school offers only when school_facts says so, with its source; " +
      "never invent programs, people or statistics. If the material is thin for a question, say what the student should think about instead. " +
      "Show the draft to the student, then save it with set_interest (prep) on the interview, adding one with log_interest if none exists.",
  };
}
