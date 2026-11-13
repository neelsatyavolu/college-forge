import { z } from "zod";
import { runChecks } from "./portal-check";
import { allow } from "./rate-limit";
import { activeShareLinks, createShareLink, revokeShareLink, shareUrl } from "./sharing";

const ORIGIN = (process.env.FORGE_ORIGIN || "https://forge.xanom.co").replace(/\/$/, "");
import { getWorkspace } from "./store";
import { ROUNDS, STATUSES, STATUS_IDS, findApp, todayIso } from "./tracker";
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
    portal_link: a.portalUrl || null,
    portal_login_saved: !!a.login?.hasPassword,
    notes: a.notes || null,
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
};
const toEdit = (f: { status?: string; round?: string; deadline?: string; decision_date?: string; submitted_date?: string; notes?: string }) => ({
  ...(f.submitted_date !== undefined ? { submittedAt: f.submitted_date } : {}),
  ...(f.status !== undefined ? { status: f.status as (typeof STATUS_IDS)[number] } : {}),
  ...(f.round !== undefined ? { round: f.round as "" } : {}),
  ...(f.deadline !== undefined ? { deadline: f.deadline } : {}),
  ...(f.decision_date !== undefined ? { decisionDate: f.decision_date } : {}),
  ...(f.notes !== undefined ? { notes: f.notes } : {}),
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
      "Every college the student is applying to, with status, round, deadline, decision date, what the portal last said, missing items and notes. Optionally filter by stage: working (not submitted yet), waiting (submitted, under review, deferred, waitlisted), admitted, denied, closed.",
    input: z.object({ stage: z.enum(["working", "waiting", "admitted", "denied", "closed"]).optional() }),
    readOnly: true,
    run: async (ws, { stage }) => {
      const t = await listApps(ws);
      const apps = t.apps.filter((a) => !stage || a.stage === stage).map(brief);
      return {
        today: todayIso(),
        automatic_portal_checks: t.autocheck,
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
      const app = findApp((await getWorkspace(ws)).tracker, school);
      if (!app) throw new TrackerError(`No single application matches "${school}". Use list_applications to see the schools.`);
      return brief(viewApp(app));
    },
  }),
  tool({
    name: "add_application",
    title: "Add an application",
    description: `Adds a college to the student's applications (matched to Forge's catalog of 330 schools when possible, which fills in the portal link). Optional fields: status (${STATUS_HELP}), round (${ROUNDS.join(", ")}), deadline and decision_date as yyyy-mm-dd, notes.`,
    input: z.object({ school: z.string().min(1).max(120), ...fields }),
    readOnly: false,
    run: async (ws, { school, ...f }) => brief(await addApp(ws, { name: school, ...toEdit(f) })),
  }),
  tool({
    name: "update_application",
    title: "Update an application",
    description: `Changes an application's status (${STATUS_HELP}), round (${ROUNDS.join(", ")} or "" to clear), deadline, decision_date, submitted_date (yyyy-mm-dd or "" to clear) or notes (replaces the notes). Moving an application to submitted records today as its submitted date unless you pass one. Only the fields you pass change. Portal links and logins can only be changed in Forge itself.`,
    input: z.object({ school: z.string().min(1), ...fields }),
    readOnly: false,
    run: async (ws, { school, ...f }) => brief(await updateApp(ws, school, toEdit(f))),
  }),
  tool({
    name: "record_decision",
    title: "Record a decision",
    description: "Records the decision the student got from a college: admitted, denied, waitlisted, deferred, committed (they're going there) or withdrawn. Optionally appends a note.",
    input: z.object({ school: z.string().min(1), decision: z.enum(DECISIONS), note: z.string().max(1000).optional() }),
    readOnly: false,
    run: async (ws, { school, decision, note }) =>
      brief(await updateApp(ws, school, (app) => ({ status: decision, ...(note ? { notes: [app.notes, note].filter(Boolean).join("\n") } : {}) }))),
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
    description: "Removes a college from the student's applications, including its saved portal login. Confirm with the student first.",
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
        throw new TrackerError("That's a lot of portal checks this hour. Forge also checks every 12 hours on its own.");
      }
      const checked = await runChecks(ws, { appIds: ids, concurrency: 4 });
      if (!checked.length) return { checked: 0, note: "No portal logins are saved in Forge yet. The student can add them on the Portals tab." };
      return { checked: checked.length, applications: checked.map((a) => brief(viewApp(a))) };
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
    description: "The student's academic summary from Forge: name, class year, high school, intended major, GPA, test scores, AP scores, and activity and honor titles.",
    input: z.object({}),
    readOnly: true,
    run: async (ws) => {
      const w = await getWorkspace(ws);
      return {
        name: w.applicant.name || null,
        cycle: w.applicant.cycle || null,
        high_school: w.profile.hs || null,
        grad_year: w.profile.gradYear || null,
        intended_major: w.profile.intended || null,
        gpa_weighted: w.applicant.gpaWeighted,
        gpa_unweighted: w.applicant.gpaUnweighted,
        sat: w.profile.testing.sat,
        ap_scores: w.profile.testing.aps,
        activities: w.profile.activities.map((a) => a.name),
        honors: w.profile.honors.map((h) => h.title),
      };
    },
  }),
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
    if (err instanceof TrackerError) return { isError: true, content: [{ type: "text", text: err.message }] };
    console.error("mcp tool failed", name, err instanceof Error ? err.message : "unknown");
    return { isError: true, content: [{ type: "text", text: "Forge couldn't do that just now. Try again." }] };
  }
}
