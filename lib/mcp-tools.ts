import { z } from "zod";
import { runChecks } from "./portal-check";
import { allow } from "./rate-limit";
import { activeShareLinks, createShareLink, revokeShareLink, shareUrl } from "./sharing";

const ORIGIN = (process.env.FORGE_ORIGIN || "https://forge.xanom.co").replace(/\/$/, "");
import { canCompleteOnboarding, getWorkspace, updateWorkspace, type Workspace } from "./store";
import { applyWorkspacePatch, checkWorkspacePatch, setTestScores, type WorkspacePatch } from "./workspace-patch";
import { removeActivity, removeHonor, toolFlag, upsertActivity, upsertHonor, type Parsed } from "./profile-fields";
import { seedRecommendedColleges } from "./college-recommendations";
import { syncEssaySupplements } from "./essay-supplements";
import { essayList, essayPromptsSchema, essayView, withEssayPrompts, withEssayVisibility } from "./essay-tools";
import { isTestOptionalNote } from "./colleges";
import { ROUNDS, STATUSES, STATUS_IDS, findApp, todayIso } from "./tracker";
import { TEST_METHODS, TEST_PLANS, studentScores } from "./testing-plan";
import { INTEREST_TOOLS } from "./interest-tools";
import {
  TrackerError,
  addApp,
  listApps,
  removeApp,
  reveal,
  updateApp,
  upcoming,
  viewApp,
  addFollowUpTo,
  updateFollowUp,
  flag,
  unflag,
  type AppView,
} from "./tracker-service";

/**
 * The tools Forge offers assistants over MCP. Each acts on the one workspace the OAuth grant belongs to.
 * Results are compact JSON meant for a model to read; passwords are never included.
 */

const STATUS_HELP = STATUSES.map((s) => `${s.id} (${s.label})`).join(", ");
const DECISIONS = ["admitted", "denied", "waitlisted", "deferred", "committed", "withdrawn"] as const;

/** One application as an assistant sees it. */
function brief(a: AppView) {
  const decision =
    a.decision.state === "hidden"
      ? "A decision is posted in the portal but the student hasn't opened it. Don't reveal it unless they ask; reveal_decision shows it."
      : a.decision.state === "revealed"
        ? `Revealed: ${a.decision.portalText || "decision posted (open the portal to read it)"}; recorded status: ${a.statusLabel}`
        : a.decision.state === "recorded"
          ? a.statusLabel
          : "none yet";
  return {
    school: a.name,
    id: a.id,
    status: a.status,
    status_label: a.statusLabel,
    round: a.round || null,
    deadline: a.deadline || null,
    decision_date: a.decisionDate ? `${a.decisionDate.date}${a.decisionDate.estimated ? " (estimated from last year)" : ""}` : null,
    next: a.nextDate ? `${a.nextDate.kind} ${a.nextDate.date}${a.nextDate.estimated ? " (estimated)" : ""}` : null,
    decision,
    portal: a.portal
      ? {
          checked_at: new Date(a.portal.checkedAt).toISOString(),
          ok: a.portal.ok,
          says: a.portal.ok ? a.portal.statusText || null : null,
          error: a.portal.ok ? null : a.portal.error,
          missing_items: a.missing,
          last_check_failed: a.lastFailure ? `${new Date(a.lastFailure.at).toISOString()}: ${a.lastFailure.error}` : null,
        }
      : null,
    submitted: a.submittedAt || null,
    follow_ups: a.followUps.map((f) => ({ id: f.id, text: f.text, due: f.due || null })),
    interest: { counts: a.interestSignal.counts, interview: a.interestSignal.interview, logged: a.interestSignal.logged, nudge: a.interestSignal.nudge ?? null },
    // A link from a forwarded email isn't offered as the portal until the student saves it in Forge.
    portal_link: a.portalFromEmail ? null : a.portalUrl || null,
    ...(a.portalFromEmail ? { portal_link_unchecked: "The portal link came from a forwarded email. Ask the student to check it and save it in Forge." } : {}),
    portal_login_saved: !!a.login?.hasPassword,
    notes: a.notes || null,
    decision_note: a.decisionNote || null,
    testing: {
      policy: a.testingPlan.policy.kind,
      policy_text: a.testingPlan.policy.text || null,
      recommendation: a.testingPlan.recommendation.label,
      reason: a.testingPlan.recommendation.reason,
      source: a.testingPlan.recommendation.sourceUrl || null,
      plan: a.testingPlan.choice.plan,
      method: a.testingPlan.choice.method ?? null,
      official_sent: a.testingPlan.choice.officialSent ?? null,
      ap_self_reported: a.testingPlan.choice.apSelfReported ?? null,
    },
  };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd").or(z.literal(""));
const fields = {
  status: z.enum(STATUS_IDS).optional(),
  round: z.enum(ROUNDS).or(z.literal("")).optional(),
  deadline: date.optional(),
  decision_date: date.optional(),
  submitted_date: date.optional(),
  notes: z.string().max(4000).optional(),
  decision_note: z.string().max(1000).optional(),
};
const toEdit = (f: { status?: string; round?: string; deadline?: string; decision_date?: string; submitted_date?: string; notes?: string; decision_note?: string }) => ({
  ...(f.submitted_date !== undefined ? { submittedAt: f.submitted_date } : {}),
  ...(f.status !== undefined ? { status: f.status as (typeof STATUS_IDS)[number] } : {}),
  ...(f.round !== undefined ? { round: f.round as "" } : {}),
  ...(f.deadline !== undefined ? { deadline: f.deadline } : {}),
  ...(f.decision_date !== undefined ? { decisionDate: f.decision_date } : {}),
  ...(f.notes !== undefined ? { notes: f.notes } : {}),
  ...(f.decision_note !== undefined ? { decisionNote: f.decision_note } : {}),
});

const testingFields = {
  test_plan: z.enum(TEST_PLANS).optional(),
  test_method: z.enum(TEST_METHODS).or(z.literal("")).optional(),
  official_scores_sent: date.optional(),
  // "yes" | "no" rather than a boolean: agents fill unused optional booleans with false.
  ap_self_reported: z.enum(["yes", "no"]).or(z.literal("")).optional(),
};
const toTestingEdit = (f: { test_plan?: (typeof TEST_PLANS)[number]; test_method?: (typeof TEST_METHODS)[number] | ""; official_scores_sent?: string; ap_self_reported?: "yes" | "no" | "" }) => {
  const t = {
    ...(f.test_plan !== undefined ? { plan: f.test_plan } : {}),
    ...(f.test_method !== undefined ? { method: f.test_method } : {}),
    ...(f.official_scores_sent !== undefined ? { officialSent: f.official_scores_sent } : {}),
    ...(f.ap_self_reported ? { apSelfReported: f.ap_self_reported === "yes" } : {}),
  };
  return Object.keys(t).length ? { testing: t } : {};
};

/** A refused profile write; its message is safe to show the assistant. */
class ProfileInputError extends Error {}

/** Validates a profile patch the way the Profile page does ("" and 0 mean not given), then saves it. */
async function saveProfilePatch(ws: string, patch: WorkspacePatch): Promise<Workspace> {
  const checked = checkWorkspacePatch(patch, "tool");
  if (!checked.ok) throw new ProfileInputError(checked.error);
  return updateWorkspace(ws, (w) => applyWorkspacePatch(w, checked.value));
}

/** Runs a list edit against the latest saved workspace. */
async function editProfile(ws: string, edit: (w: Workspace) => Parsed<Workspace>): Promise<Workspace> {
  return updateWorkspace(ws, (w) => {
    const r = edit(w);
    if (!r.ok) throw new ProfileInputError(r.error);
    return r.value;
  });
}

const present = (v: string | undefined) => (v && v !== "—" ? v : null);

function profileView(w: Workspace) {
  const p = w.profile;
  const prefs = w.onboarding.listPrefs;
  return {
    name: w.applicant.name || null,
    cycle: w.applicant.cycle || null,
    high_school: p.hs || null,
    grad_year: p.gradYear || null,
    intended_major: p.intended || null,
    location: p.location || null,
    residency: p.residency || null,
    counselor: p.counselor || null,
    gpa_weighted: present(w.applicant.gpaWeighted),
    gpa_unweighted: present(w.applicant.gpaUnweighted),
    sat: present(p.testing.sat) ?? present(w.applicant.sat),
    sat_note: p.testing.satNote || w.applicant.satNote || null,
    test_optional: isTestOptionalNote(p.testing.satNote || w.applicant.satNote),
    act: present(p.testing.act),
    ap_scores: p.testing.aps,
    coursework: p.coursework,
    activities: p.activities.map((a) => ({
      rank: a.rank, name: a.name, type: a.type || null, organization: a.org || null, role: a.role || null,
      grades: a.years || null, hours_per_week: a.hpw || null, weeks_per_year: a.wpy || null, description: a.desc || null,
    })),
    honors: p.honors.map((h) => ({ title: h.title, level: h.level || null, year: h.year || null, top: !!h.top })),
    list_preferences: prefs
      ? {
          ambition: prefs.ambition, app_count: prefs.appCount ?? null, regions: prefs.regions, settings: prefs.settings,
          notes: prefs.notes || null, budget: prefs.budget ?? null, need_aid: prefs.needAid ?? null, early_decision: prefs.ed ?? null,
        }
      : null,
    onboarding_complete: !!w.onboarding.completed,
  };
}

/** Agents fill unused optional booleans with false, so tool flags are "yes" | "no", and "" means unchanged. */
const yesNo = z.enum(["yes", "no"]).or(z.literal("")).optional();
const activityInput = {
  name: z.string().max(200).optional(),
  type: z.string().max(80).optional(),
  organization: z.string().max(200).optional(),
  role: z.string().max(200).optional(),
  grades: z.string().max(80).optional(),
  hours_per_week: z.string().max(10).optional(),
  weeks_per_year: z.string().max(10).optional(),
  continue_in_college: yesNo,
  description: z.string().max(150).optional(),
};
const toActivity = (f: z.infer<z.ZodObject<typeof activityInput>> & { rank?: number }) => ({
  rank: f.rank, name: f.name, type: f.type, org: f.organization, role: f.role, years: f.grades,
  hpw: f.hours_per_week, wpy: f.weeks_per_year, college: toolFlag(f.continue_in_college), desc: f.description,
});

type Tool = {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  readOnly: boolean;
  run: (ws: string, args: never) => Promise<unknown>;
};

const tool = <S extends z.ZodObject>(t: { name: string; title: string; description: string; input: S; readOnly: boolean; run: (ws: string, args: z.infer<S>) => Promise<unknown> }) =>
  t as unknown as Tool;

export const TOOLS: Tool[] = [
  tool({
    name: "list_applications",
    title: "List applications",
    description:
      "Every college the student is applying to, with status, round, deadline, decision date, what the portal last said, missing items and notes. Optionally filter by stage: working (not started, writing, final checks), waiting (submitted, under review, deferred, waitlisted), admitted, denied, closed.",
    input: z.object({ stage: z.enum(["working", "waiting", "admitted", "denied", "closed"]).optional() }),
    readOnly: true,
    run: async (ws, { stage }) => {
      const t = await listApps(ws);
      const apps = t.apps.filter((a) => !stage || a.stage === stage).map(brief);
      return {
        today: todayIso(),
        automatic_portal_checks: t.autocheck,
        portal_check_times: { times: t.schedule.times, time_zone: t.schedule.timeZone, every_hours: t.schedule.everyHours },
        count: apps.length,
        flags: t.flags.map((f) => ({ id: f.id, text: f.text, scope: f.scope || null })),
        applications: apps,
      };
    },
  }),
  tool({
    name: "get_application",
    title: "Get one application",
    description: "One application in full. `school` can be the name (or a unique part of it, like \"Michigan\"), a catalog id, or the id from list_applications.",
    input: z.object({ school: z.string().min(1) }),
    readOnly: true,
    run: async (ws, { school }) => {
      const w = await getWorkspace(ws);
      const app = findApp(w.tracker, school);
      if (!app) throw new TrackerError(`No single application matches "${school}". Use list_applications to see the schools.`);
      return brief(viewApp(app, todayIso(), studentScores(w)));
    },
  }),
  tool({
    name: "add_application",
    title: "Add an application",
    description: `Adds a college to the student's applications (matched to Forge's catalog of 330 schools when possible, which fills in the portal link). The school also joins the student's college list and its Essays group. Optional fields: status (${STATUS_HELP}), round (${ROUNDS.join(", ")}), deadline and decision_date (when the decision is expected; replaces Forge's estimate from last year) as yyyy-mm-dd, notes.`,
    input: z.object({ school: z.string().min(1).max(120), ...fields }),
    readOnly: false,
    run: async (ws, { school, ...f }) => brief(await addApp(ws, { name: school, ...toEdit(f) })),
  }),
  tool({
    name: "update_application",
    title: "Update an application",
    description: `Changes an application's status (${STATUS_HELP}), round (${ROUNDS.join(", ")} or "" to clear), deadline, decision_date (when the decision is expected, e.g. from a school email or website; replaces Forge's estimate from last year, "" goes back to the estimate), submitted_date (yyyy-mm-dd or "" to clear), notes (replaces the notes) or decision_note (the note shown with the decision on the Progress tab and progress links; "" to clear). Moving an application to submitted records today as its submitted date unless you pass one. Testing plan for this school: test_plan (send, withhold or undecided: whether SAT/ACT scores go to this school; get_application shows Forge's sourced recommendation), test_method (self_report or official, "" to clear), official_scores_sent (yyyy-mm-dd the College Board/ACT report was ordered, "" to clear), ap_self_reported (yes or no). Only the fields you pass change. Portal links and logins can only be changed in Forge itself.`,
    input: z.object({ school: z.string().min(1), ...fields, ...testingFields }),
    readOnly: false,
    run: async (ws, { school, test_plan, test_method, official_scores_sent, ap_self_reported, ...f }) =>
      brief(await updateApp(ws, school, { ...toEdit(f), ...toTestingEdit({ test_plan, test_method, official_scores_sent, ap_self_reported }) })),
  }),
  tool({
    name: "record_decision",
    title: "Record a decision",
    description: "Records the decision the student got from a college: admitted, denied, waitlisted, deferred, committed (they're going there) or withdrawn. Optionally sets a decision note (shown with the decision on the Progress tab and progress links, so parents and counselors see it; replaces any earlier decision note).",
    input: z.object({ school: z.string().min(1), decision: z.enum(DECISIONS), note: z.string().max(1000).optional() }),
    readOnly: false,
    run: async (ws, { school, decision, note }) => brief(await updateApp(ws, school, { status: decision, ...(note !== undefined ? { decisionNote: note } : {}) })),
  }),
  tool({
    name: "reveal_decision",
    title: "Reveal a posted decision",
    description:
      "Forge hides a decision a portal posted until the student chooses to see it. Call this only when the student asks to know the decision; it marks the decision as seen and returns what the portal says.",
    input: z.object({ school: z.string().min(1) }),
    readOnly: false,
    run: async (ws, { school }) => brief(await reveal(ws, school)),
  }),
  tool({
    name: "remove_application",
    title: "Remove an application",
    description: "Removes a college from the student's applications, including its saved portal login. An untouched application (Not started, no login, notes or follow-ups) also leaves the college list; otherwise the school stays on the list. Essay drafts are kept. Confirm with the student first.",
    input: z.object({ school: z.string().min(1) }),
    readOnly: false,
    run: async (ws, { school }) => removeApp(ws, school),
  }),
  tool({
    name: "add_follow_up",
    title: "Add a follow-up",
    description: "Adds a to-do under one application, shown on the student's progress page as \"→ text · due\" (for example \"Counselor uploads the SUNY form\" due 2026-11-01). Use for anything that still has to happen for that school.",
    input: z.object({ school: z.string().min(1), text: z.string().min(1).max(300), due: date.optional() }),
    readOnly: false,
    run: async (ws, { school, text, due }) => brief(await addFollowUpTo(ws, school, text, due ?? "")),
  }),
  tool({
    name: "complete_follow_up",
    title: "Complete or remove a follow-up",
    description: "Marks a follow-up done (it disappears from the progress page), or removes it with remove: true. Get ids from list_applications.",
    input: z.object({ school: z.string().min(1), follow_up_id: z.string().min(1), remove: z.boolean().optional() }),
    readOnly: false,
    run: async (ws, { school, follow_up_id, remove }) => brief(await updateFollowUp(ws, school, follow_up_id, remove ? { remove: true } : { done: true })),
  }),
  tool({
    name: "add_flag",
    title: "Flag a problem",
    description: "Adds a flag at the top of the progress page for something that needs attention across applications, like a missing teacher evaluation. `scope` says what it affects (\"All Common App schools\" or a school's name).",
    input: z.object({ text: z.string().min(1).max(500), scope: z.string().max(80).optional() }),
    readOnly: false,
    run: async (ws, { text, scope }) => ({ flags: (await flag(ws, text, scope ?? "")).flags }),
  }),
  tool({
    name: "resolve_flag",
    title: "Resolve a flag",
    description: "Clears a flag once the problem is fixed. Get ids from list_applications.",
    input: z.object({ flag_id: z.string().min(1) }),
    readOnly: false,
    run: async (ws, { flag_id }) => ({ flags: (await unflag(ws, flag_id)).flags }),
  }),
  tool({
    name: "upcoming_dates",
    title: "Upcoming dates",
    description: "Deadlines, decision dates (exact or estimated from last year) and the student's own dates in the next `days` days (default 120), soonest first.",
    input: z.object({ days: z.number().int().min(1).max(400).optional() }),
    readOnly: true,
    run: async (ws, { days }) => ({ today: todayIso(), dates: upcoming(await getWorkspace(ws), todayIso(), days ?? 120) }),
  }),
  tool({
    name: "check_portals",
    title: "Check portals now",
    description:
      "Signs in to application portals with the logins the student saved in Forge and reads the current status, checklist and any posted decision (kept hidden until revealed). Pass `school` for one, or nothing for all with saved logins. Can take up to a minute.",
    input: z.object({ school: z.string().optional() }),
    readOnly: false,
    run: async (ws, { school }) => {
      let ids: string[] | undefined;
      if (school) {
        const app = findApp((await getWorkspace(ws)).tracker, school);
        if (!app) throw new TrackerError(`No single application matches "${school}".`);
        ids = [app.id];
      }
      if (!(await allow(`check-ws:${ws}`, 120, 60 * 60 * 1000))) {
        throw new TrackerError("That's a lot of portal checks this hour. Forge also checks on its own schedule.");
      }
      // The assistant may not tell the student what it found, so news from this check is emailed as usual.
      const checked = await runChecks(ws, { appIds: ids, concurrency: 4, notify: true });
      if (!checked.length) return { checked: 0, note: "No portal logins are saved in Forge yet. The student can add them on the Portals tab." };
      const scores = studentScores(await getWorkspace(ws));
      return { checked: checked.length, applications: checked.map((a) => brief(viewApp(a, todayIso(), scores))) };
    },
  }),
  tool({
    name: "list_share_links",
    title: "List share links",
    description: "The student's active share links. Progress links (for parents or counselors) show the progress page: statuses, dates, follow-ups, flags and opened decisions. Full advisor links exist too, but their addresses are only shown in Forge, since they include essays.",
    input: z.object({}),
    readOnly: true,
    run: async (ws) => ({
      links: (await activeShareLinks(ws)).map((l) => ({
        id: l.token.slice(0, 10), label: l.label, scope: l.scope ?? "full",
        url: l.scope === "progress" ? shareUrl(ORIGIN, l.token) : null,
        created: new Date(l.createdAt).toISOString(),
      })),
    }),
  }),
  tool({
    name: "create_share_link",
    title: "Create a progress link",
    description: "Makes a read-only progress link for a parent or counselor: the student's applications, statuses, dates, follow-ups, flags and opened decisions, never essays, logins or unopened decisions. Ask the student first and say who it's for in `label`. Anyone with the link can see it until it's turned off. Full advisor links can only be made in Forge.",
    input: z.object({ label: z.string().min(1).max(60) }),
    readOnly: false,
    run: async (ws, { label }) => {
      const { token } = await createShareLink(ws, "progress", label);
      return { label, scope: "progress", url: shareUrl(ORIGIN, token) };
    },
  }),
  tool({
    name: "revoke_share_link",
    title: "Turn off a share link",
    description: "Turns off a share link for good. `link` is the id or url from list_share_links.",
    input: z.object({ link: z.string().min(6) }),
    readOnly: false,
    run: async (ws, { link }) => {
      const match = (await activeShareLinks(ws)).find((l) => link.includes(l.token) || (link.length >= 10 && l.token.startsWith(link)));
      if (!match) throw new TrackerError("No active share link matches that. Use list_share_links.");
      await revokeShareLink(ws, match.token);
      return { turned_off: match.label };
    },
  }),
  tool({
    name: "get_notes",
    title: "Read notes from parents and counselors",
    description: "Notes parents, counselors and advisors left through the student's share links, newest first. Notes about essays are left out.",
    input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
    readOnly: true,
    run: async (ws, { limit }) => ({
      notes: [...(await getWorkspace(ws)).advisorNotes].filter((n) => !n.essayId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit ?? 20)
        .map((n) => ({ from: n.author, at: new Date(n.createdAt).toISOString(), text: n.body })),
    }),
  }),
  tool({
    name: "get_shortlist",
    title: "Get the college shortlist",
    description: "Colleges the student is considering (their Forge shortlist), with reach/target/likely category, location, admit rate and deadline when known. These are not necessarily applications.",
    input: z.object({}),
    readOnly: true,
    run: async (ws) => {
      const w = await getWorkspace(ws);
      const tracked = new Set(w.tracker.apps.map((a) => a.slug).filter(Boolean));
      return {
        colleges: w.colleges.map((c) => ({
          name: c.name, slug: c.slug, category: c.tier ?? null, location: c.location ?? null,
          admit_rate: c.admit ?? null, deadline: c.deadline ?? null, applying: tracked.has(c.slug),
        })),
      };
    },
  }),
  tool({
    name: "get_profile",
    title: "Get the student's profile",
    description: "Everything the student can edit on their Forge profile: name, class year, high school, intended major, location, state of residence, counselor, GPA, SAT and its note (test optional or not), ACT, AP scores, coursework, activities with details, honors with levels, and college-list preferences.",
    input: z.object({}),
    readOnly: true,
    run: async (ws) => profileView(await getWorkspace(ws)),
  }),
  tool({
    name: "update_profile",
    title: "Update the student's profile",
    description: "Changes profile fields. Only the fields you pass change; empty strings and 0 are ignored, and \"—\" clears a GPA, SAT or ACT. gpa_unweighted 0-4, gpa_weighted 0-6, sat a whole number 400-1600, act 1-36, grad_year four digits, residency a 2-letter state code. test_optional yes marks testing as optional (scores are then ignored for list building); no removes that mark. SAT is saved everywhere Forge reads it.",
    input: z.object({
      name: z.string().max(200).optional(),
      cycle: z.string().max(200).optional(),
      high_school: z.string().max(200).optional(),
      grad_year: z.union([z.number(), z.string()]).optional(),
      intended_major: z.string().max(200).optional(),
      location: z.string().max(200).optional(),
      residency: z.string().max(40).optional(),
      counselor: z.string().max(200).optional(),
      gpa_weighted: z.string().max(10).optional(),
      gpa_unweighted: z.string().max(10).optional(),
      sat: z.string().max(10).optional(),
      sat_note: z.string().max(200).optional(),
      test_optional: yesNo,
      act: z.string().max(10).optional(),
    }),
    readOnly: false,
    run: async (ws, f) => {
      const patch: WorkspacePatch = {
        applicant: { name: f.name, cycle: f.cycle, gpaWeighted: f.gpa_weighted, gpaUnweighted: f.gpa_unweighted },
        profile: {
          hs: f.high_school, gradYear: f.grad_year, intended: f.intended_major, location: f.location,
          residency: f.residency, counselor: f.counselor,
          testing: { sat: f.sat, act: f.act },
        },
      };
      const checked = checkWorkspacePatch(patch, "tool");
      if (!checked.ok) throw new ProfileInputError(checked.error);
      const saved = await updateWorkspace(ws, (w) => {
        const next = applyWorkspacePatch(w, checked.value);
        const note = w.profile.testing.satNote || w.applicant.satNote;
        // Turning test-optional off clears only the note it set, which "" in tool mode could not express.
        const testOptional = toolFlag(f.test_optional);
        const satNote = testOptional === true ? "Test optional"
          : f.sat_note ? f.sat_note.trim()
          : testOptional === false && isTestOptionalNote(note) ? "" : undefined;
        return satNote === undefined ? next : setTestScores(next, { satNote });
      });
      return profileView(saved);
    },
  }),
  tool({
    name: "update_list_preferences",
    title: "Update college-list preferences",
    description: "Changes the preferences Forge uses to build the college list. Only the fields you pass change. ambition: ambitious, balanced or conservative. app_count: 8-15 applications. regions: northeast, mid-atlantic, south, midwest, west, any. settings: urban, suburban, rural, college-town. budget: lt15, 15-30, 30-50, 50plus or unsure (thousands of dollars a year). need_aid: yes or no. The saved list itself does not change.",
    input: z.object({
      ambition: z.enum(["ambitious", "balanced", "conservative"]).or(z.literal("")).optional(),
      app_count: z.number().optional(),
      regions: z.array(z.enum(["northeast", "mid-atlantic", "south", "midwest", "west", "any"])).optional(),
      settings: z.array(z.enum(["urban", "suburban", "rural", "college-town"])).optional(),
      notes: z.string().max(4000).optional(),
      budget: z.enum(["lt15", "15-30", "30-50", "50plus", "unsure"]).or(z.literal("")).optional(),
      need_aid: yesNo,
      early_decision: z.enum(["yes", "no", "maybe"]).or(z.literal("")).optional(),
    }),
    readOnly: false,
    run: async (ws, f) => {
      const listPrefs = {
        ambition: f.ambition || undefined, appCount: f.app_count, regions: f.regions, settings: f.settings,
        notes: f.notes, budget: f.budget || undefined, needAid: toolFlag(f.need_aid), ed: f.early_decision || undefined,
      } as WorkspacePatch["listPrefs"];
      return { list_preferences: profileView(await saveProfilePatch(ws, { listPrefs })).list_preferences };
    },
  }),
  tool({
    name: "upsert_activity",
    title: "Add or change an activity",
    description: "Adds one activity, or changes fields of a saved one matched by `match` (its current name) or `name`. Only the fields you pass change. `rank` moves it to that position (1 = most important). Up to 10 activities; descriptions up to 150 characters.",
    input: z.object({ match: z.string().max(200).optional(), rank: z.number().int().optional(), ...activityInput }),
    readOnly: false,
    run: async (ws, { match, ...f }) => {
      const saved = await editProfile(ws, (w) => {
        const r = upsertActivity(w.profile.activities, toActivity(f), match || undefined);
        return r.ok ? { ok: true, value: { ...w, profile: { ...w.profile, activities: r.value.list } } } : r;
      });
      return { activities: profileView(saved).activities };
    },
  }),
  tool({
    name: "remove_activity",
    title: "Remove an activity",
    description: "Removes one activity by name (or by rank). The rest are renumbered. Confirm with the student first.",
    input: z.object({ name: z.string().max(200).optional(), rank: z.number().int().optional() }),
    readOnly: false,
    run: async (ws, { name, rank }) => {
      if (!name && !rank) throw new ProfileInputError("Pass the activity's name or rank.");
      const saved = await editProfile(ws, (w) => {
        const r = removeActivity(w.profile.activities, { name: name || undefined, rank: rank || undefined });
        return r.ok ? { ok: true, value: { ...w, profile: { ...w.profile, activities: r.value } } } : r;
      });
      return { activities: profileView(saved).activities };
    },
  }),
  tool({
    name: "upsert_honor",
    title: "Add or change an honor",
    description: "Adds one honor or award, or changes a saved one matched by `match` (its current title) or `title`. level: International, National, State, Regional or School. top: yes marks one of the strongest, no unmarks it. Up to 5 honors.",
    input: z.object({
      match: z.string().max(200).optional(), title: z.string().max(200).optional(), level: z.string().max(40).optional(),
      year: z.string().max(40).optional(), top: yesNo,
    }),
    readOnly: false,
    run: async (ws, { match, top, ...f }) => {
      const saved = await editProfile(ws, (w) => {
        const r = upsertHonor(w.profile.honors, { ...f, top: toolFlag(top) }, match || undefined);
        return r.ok ? { ok: true, value: { ...w, profile: { ...w.profile, honors: r.value.list }, applicant: { ...w.applicant, awards: r.value.list.length } } } : r;
      });
      return { honors: profileView(saved).honors };
    },
  }),
  tool({
    name: "remove_honor",
    title: "Remove an honor",
    description: "Removes one honor by title. Confirm with the student first.",
    input: z.object({ title: z.string().max(200).optional() }),
    readOnly: false,
    run: async (ws, { title }) => {
      if (!title) throw new ProfileInputError("Pass the honor's title.");
      const saved = await editProfile(ws, (w) => {
        const r = removeHonor(w.profile.honors, title);
        return r.ok ? { ok: true, value: { ...w, profile: { ...w.profile, honors: r.value }, applicant: { ...w.applicant, awards: r.value.length } } } : r;
      });
      return { honors: profileView(saved).honors };
    },
  }),
  tool({
    name: "list_essays",
    title: "List essays",
    description: "Every essay prompt on the student's Essays tab: Common App (school \"common\"), UC PIQs (\"uc-application\") and each school's supplements, with limit, word count and status. `hidden: true` marks essays the student hid or Common App prompts they did not choose; skip those. `chosen: true` marks their Common App prompt. Draft text is left out; use get_essay for one essay.",
    input: z.object({}),
    readOnly: true,
    run: async (ws) => ({ essays: essayList(await getWorkspace(ws)) }),
  }),
  tool({
    name: "get_essay",
    title: "Get one essay",
    description: "One essay in full: the prompt, its limit, the student's current draft and count, and its status. `id` comes from list_essays.",
    input: z.object({ id: z.string().min(1).max(200) }),
    readOnly: true,
    run: async (ws, { id }) => {
      const view = essayView(await getWorkspace(ws), id);
      if (!view) throw new ProfileInputError(`No essay has the id "${id}". Use list_essays to see the ids.`);
      return view;
    },
  }),
  tool({
    name: "set_essays",
    title: "Set essay prompts",
    description: "Saves essay prompts copied from a school's current application. `supplements` maps a school slug from get_shortlist (or \"uc-application\") to its full prompt list, which replaces that school's prompts; other schools are untouched, and an empty list removes the school's group. `commonApp` replaces the Common App prompts. Keep an existing prompt's id to keep the student's draft attached. Each prompt needs id, label, prompt, limit and unit (words or characters); set required false for optional prompts. This never changes drafts.",
    input: essayPromptsSchema,
    readOnly: false,
    run: async (ws, prompts) => {
      if (!prompts.commonApp?.length && !prompts.supplements) throw new ProfileInputError("Pass commonApp or supplements.");
      const saved = await updateWorkspace(ws, (w) => withEssayPrompts(w, prompts));
      const changed = new Set([...(prompts.commonApp?.length ? ["common"] : []), ...Object.keys(prompts.supplements || {})]);
      return { essays: essayList(saved).filter((e) => changed.has(e.school)) };
    },
  }),
  tool({
    name: "set_essay_visibility",
    title: "Hide, show or choose essays",
    description: "Only when the student asks: hide essays they won't write (`hide`, ids from list_essays), show hidden ones again (`show`), or choose their Common App personal essay prompt (`common_app_prompt`, a ca-ps-* id; null clears the choice and shows all six). Hidden essays keep their drafts.",
    input: z.object({
      hide: z.array(z.string().min(1).max(200)).max(100).optional(),
      show: z.array(z.string().min(1).max(200)).max(100).optional(),
      common_app_prompt: z.string().max(200).nullable().optional(),
    }),
    readOnly: false,
    run: async (ws, { hide, show, common_app_prompt }) => {
      const saved = await editProfile(ws, (w) => withEssayVisibility(w, { hide, show, commonAppPrompt: common_app_prompt }));
      return { essays: essayList(saved).filter((e) => e.hidden || e.chosen).map(({ id, label, hidden, chosen }) => ({ id, label, hidden, chosen: !!chosen })) };
    },
  }),
  tool({
    name: "complete_onboarding",
    title: "Finish Forge setup",
    description: "Finishes the student's Forge setup once the profile has a name, high school, intended major, graduation year and at least one GPA (fill those with update_profile first). Builds a starting college list from the profile and list preferences, keeping any schools already saved.",
    input: z.object({}),
    readOnly: false,
    run: async (ws) => {
      const saved = await updateWorkspace(ws, (w) => {
        if (w.onboarding.completed) return w;
        const check = canCompleteOnboarding(w);
        if (!check.ok) throw new ProfileInputError(check.error);
        const seeded = seedRecommendedColleges(w);
        const next = syncEssaySupplements({ ...w, colleges: seeded.colleges });
        return { ...next, onboarding: { ...next.onboarding, completed: true, completedAt: Date.now(), listGaps: seeded.gaps } };
      });
      return {
        onboarding_complete: true,
        colleges: saved.colleges.map((c) => ({ name: c.name, category: c.tier ?? null })),
      };
    },
  }),
  ...INTEREST_TOOLS.map((t) => t as unknown as Tool),
];

/** JSON Schema for tools/list (zod 4 converts directly). */
export function toolList() {
  return TOOLS.map((t) => {
    const { $schema: _s, ...inputSchema } = z.toJSONSchema(t.input) as Record<string, unknown>;
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema,
      annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: t.name === "remove_application", openWorldHint: t.name === "check_portals" },
    };
  });
}

export async function callTool(workspaceId: string, name: string, args: unknown) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { isError: true, content: [{ type: "text", text: `Unknown tool "${name}".` }] };
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success) {
    return { isError: true, content: [{ type: "text", text: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}` }] };
  }
  try {
    const result = await t.run(workspaceId, parsed.data as never);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  } catch (err) {
    if (err instanceof TrackerError || err instanceof ProfileInputError) return { isError: true, content: [{ type: "text", text: err.message }] };
    console.error("mcp tool failed", name, err instanceof Error ? err.message : "unknown");
    return { isError: true, content: [{ type: "text", text: "Forge couldn't do that just now. Try again." }] };
  }
}
