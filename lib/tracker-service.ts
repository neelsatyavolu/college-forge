import { logoUrl } from "./catalog";
import { deleteDoc, writeDoc } from "./doc-store";
import { fetchCollegeAppsVault, toTracked } from "./collegeapps-import";
import { readLogins, saveLogins, type PortalLogin } from "./portal-logins";
import { loginHost } from "./portal-check";
import { getWorkspace, updateWorkspace, type Workspace } from "./store";
import {
  decisionDateOf,
  decisionOf,
  editApp,
  effectiveRound,
  findApp,
  matchCatalog,
  missingItems,
  newApp,
  nextDate,
  replaceApp,
  revealDecision,
  shownPortal,
  statusInfo,
  todayIso,
  type AppEdit,
  type TrackedApp,
  type Tracker,
} from "./tracker";

/**
 * Everything that reads or changes the tracker goes through here: the hub's API, the AI copilot and the MCP
 * server. Errors thrown as TrackerError carry messages meant for the student (or their assistant).
 */

export class TrackerError extends Error {}

/** What clients see for one application: derived dates, the decision state, and never a password. */
export function viewApp(app: TrackedApp, today = todayIso()) {
  const info = statusInfo(app.status);
  const decision = decisionOf(app);
  const portal = shownPortal(app);
  return {
    id: app.id,
    collegeId: app.collegeId,
    slug: app.slug ?? null,
    name: app.name,
    logo: app.collegeId ? (logoUrl(app.collegeId) ?? null) : null,
    portalName: app.portalName,
    portalUrl: app.portalUrl,
    status: app.status,
    statusLabel: info.label,
    stage: info.stage,
    round: effectiveRound(app),
    roundFromPortal: !app.round && !!app.portal?.round,
    deadline: app.deadline,
    decisionDate: decisionDateOf(app, today),
    // Once a decision is posted, its expected date is no longer news.
    nextDate: decision.state === "hidden" || decision.state === "revealed" ? null : nextDate(app, today),
    decision,
    portal: portal
      ? { checkedAt: portal.checkedAt, ok: portal.ok, error: portal.error, statusText: portal.statusText, update: portal.update, checklist: portal.checklist }
      : null,
    missing: missingItems(app),
    lastFailure: app.lastFailure ?? null,
    notes: app.notes,
    login: app.login ?? null,
    lastChecked: app.lastChecked,
    updatedAt: app.updatedAt,
  };
}
export type AppView = ReturnType<typeof viewApp>;

/** `revision` is the workspace's; the hub ignores a response older than one it already has. */
export function viewTracker(tracker: Tracker, today = todayIso(), revision = 0) {
  return { revision, autocheck: tracker.autocheck, apps: tracker.apps.map((a) => viewApp(a, today)) };
}

const autocheckKey = (workspaceId: string) => `autocheck/${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`;

/** Keeps the sweep's index in step: listed while automatic checks are on and some login is saved. */
async function syncAutocheckIndex(workspaceId: string, _after?: Tracker): Promise<void> {
  // Re-read rather than trust the caller's copy, so a slower request can't restore an index entry a newer one removed.
  // The sweep also checks the workspace's own switch, so a stale entry never causes a check.
  const { tracker } = await getWorkspace(workspaceId);
  const wanted = tracker.autocheck && tracker.apps.some((a) => a.login?.hasPassword);
  if (wanted) await writeDoc(autocheckKey(workspaceId), { workspaceId });
  else await deleteDoc(autocheckKey(workspaceId));
}

function mustFind(tracker: Tracker, ref: string): TrackedApp {
  const app = findApp(tracker, ref);
  if (!app) throw new TrackerError(`No application matches "${ref}". Use list_applications to see the schools.`);
  return app;
}

async function mutate(workspaceId: string, change: (tracker: Tracker, ws: Workspace) => Tracker): Promise<Workspace> {
  try {
    return await updateWorkspace(workspaceId, (ws) => ({ ...ws, tracker: change(ws.tracker, ws) }));
  } catch (err) {
    if (err instanceof Error && err.message && /^(Unknown|Deadline|Decision|Portal|No application|Already)/.test(err.message)) {
      throw new TrackerError(err.message);
    }
    throw err;
  }
}

export async function listApps(workspaceId: string) {
  const ws = await getWorkspace(workspaceId);
  return viewTracker(ws.tracker, todayIso(), ws.revision);
}

export async function addApp(
  workspaceId: string,
  input: { name?: string; collegeId?: string; slug?: string; portalUrl?: string } & AppEdit,
): Promise<AppView> {
  const name = (input.name ?? "").trim();
  if (!name && !input.collegeId) throw new TrackerError("Give the school's name.");
  let createdId = "";
  const ws = await mutate(workspaceId, (tracker, current) => {
    const catalog = input.collegeId ? matchCatalog(input.collegeId) : matchCatalog(name);
    const dup = tracker.apps.find(
      (a) => (catalog && a.collegeId === catalog.id) || (input.slug && a.slug === input.slug) || a.name.toLowerCase() === name.toLowerCase(),
    );
    if (dup) {
      createdId = dup.id;
      // Linking a shortlist school to an application someone already added by name.
      return input.slug && !dup.slug ? replaceApp(tracker, { ...dup, slug: input.slug }) : tracker;
    }
    const slug = input.slug ?? current.colleges.find((c) => catalog && matchCatalog(c.name)?.id === catalog.id)?.slug;
    const { name: _n, collegeId: _c, slug: _s, portalUrl, ...edit } = input;
    const app = editApp(newApp({ name: name || catalog?.name || "", collegeId: catalog?.id ?? null, slug, portalUrl }), edit);
    createdId = app.id;
    return { ...tracker, apps: [...tracker.apps, app] };
  });
  return viewApp(ws.tracker.apps.find((a) => a.id === createdId)!);
}

/**
 * Edits one application. `edit` may be a function of the current application, so changes that depend on it
 * (appending a note) are computed inside the same write. Moving the portal to a different host forgets the
 * saved login, so a password is never sent somewhere it wasn't saved for.
 */
export async function updateApp(workspaceId: string, ref: string, edit: AppEdit | ((app: TrackedApp) => AppEdit)): Promise<AppView> {
  let id = "";
  let dropLogin = false;
  const ws = await mutate(workspaceId, (tracker) => {
    const app = mustFind(tracker, ref);
    id = app.id;
    let next = editApp(app, typeof edit === "function" ? edit(app) : edit);
    dropLogin = !!app.login && loginHost(next) !== loginHost(app);
    if (dropLogin) {
      const { login: _l, ...rest } = next;
      next = rest;
    }
    return replaceApp(tracker, next);
  });
  if (dropLogin) {
    await saveLogins(workspaceId, { [id]: null });
    await syncAutocheckIndex(workspaceId, ws.tracker);
  }
  return viewApp(ws.tracker.apps.find((a) => a.id === id)!);
}

export async function removeApp(workspaceId: string, ref: string): Promise<{ removed: string }> {
  let removed: TrackedApp | undefined;
  const ws = await mutate(workspaceId, (tracker) => {
    removed = mustFind(tracker, ref);
    return { ...tracker, apps: tracker.apps.filter((a) => a.id !== removed!.id) };
  });
  await saveLogins(workspaceId, { [removed!.id]: null });
  await syncAutocheckIndex(workspaceId, ws.tracker);
  return { removed: removed!.name };
}

export async function reveal(workspaceId: string, ref: string): Promise<AppView> {
  let id = "";
  const ws = await mutate(workspaceId, (tracker) => {
    const app = mustFind(tracker, ref);
    id = app.id;
    return replaceApp(tracker, revealDecision(app));
  });
  return viewApp(ws.tracker.apps.find((a) => a.id === id)!);
}

/** Saves (or with null, forgets) one school's portal login. Only the username is ever shown back. */
export async function setLogin(workspaceId: string, ref: string, login: PortalLogin | null): Promise<AppView> {
  if (login && (!login.username.trim() || !login.password)) throw new TrackerError("Enter both the portal username and password.");
  const current = mustFind((await getWorkspace(workspaceId)).tracker, ref);
  const host = loginHost(current);
  if (login && !host) throw new TrackerError("Add the portal link before saving its login.");
  await saveLogins(workspaceId, { [current.id]: login ? { username: login.username.trim(), password: login.password, host: host! } : null });
  const ws = await mutate(workspaceId, (tracker) => {
    const app = tracker.apps.find((a) => a.id === current.id);
    if (!app) return tracker;
    const { login: _old, ...rest } = app;
    const next = login ? { ...rest, login: { username: login.username.trim(), hasPassword: true } } : rest;
    return replaceApp(tracker, { ...next, updatedAt: Date.now() });
  });
  await syncAutocheckIndex(workspaceId, ws.tracker);
  return viewApp(ws.tracker.apps.find((a) => a.id === current.id)!);
}

export async function setAutocheck(workspaceId: string, on: boolean) {
  const ws = await mutate(workspaceId, (tracker) => ({ ...tracker, autocheck: on }));
  await syncAutocheckIndex(workspaceId, ws.tracker);
  return viewTracker(ws.tracker, todayIso(), ws.revision);
}

/**
 * Brings a College Apps account in: new schools are added, schools already here only gain a missing login.
 * Logins are saved before the applications that point at them, so a failure part way can be retried.
 */
export async function importFromCollegeApps(workspaceId: string, email: string, password: string) {
  if (!email.includes("@") || !password) throw new TrackerError("Enter your College Apps email and password.");
  const incoming = toTracked(await fetchCollegeAppsVault(email, password));
  const before = await getWorkspace(workspaceId);
  const saved = await readLogins(workspaceId);
  const same = (a: TrackedApp, b: TrackedApp) => (!!b.collegeId && a.collegeId === b.collegeId) || a.name.toLowerCase() === b.name.toLowerCase();
  const logins: Record<string, PortalLogin> = {};
  for (const { app, login } of incoming) {
    if (!login) continue;
    const existing = before.tracker.apps.find((a) => same(a, app));
    if (!existing) logins[app.id] = login;
    else if (!saved[existing.id]) logins[existing.id] = login;
  }
  if (Object.keys(logins).length) await saveLogins(workspaceId, logins);
  let added = 0;
  let linked = 0;
  const ws = await mutate(workspaceId, (tracker) => {
    let next = tracker;
    added = 0;
    linked = 0;
    for (const { app } of incoming) {
      const existing = next.apps.find((a) => same(a, app));
      if (existing) {
        // A login saved by an earlier attempt that failed before this write counts too.
        const login = logins[existing.id] ?? saved[existing.id];
        if (login && !existing.login?.hasPassword) {
          next = replaceApp(next, { ...existing, login: { username: login.username, hasPassword: true }, updatedAt: Date.now() });
          linked++;
        }
        continue;
      }
      const { login: _meta, ...rest } = app;
      const login = logins[app.id];
      next = { ...next, apps: [...next.apps, login ? { ...rest, login: { username: login.username, hasPassword: true } } : rest] };
      added++;
    }
    return next;
  });
  await syncAutocheckIndex(workspaceId, ws.tracker);
  return { added, linked, total: incoming.length, tracker: viewTracker(ws.tracker, todayIso(), ws.revision) };
}

/** Upcoming deadlines and decision dates, soonest first, plus the student's own dates from the timeline. */
export function upcoming(ws: Workspace, today = todayIso(), days = 120) {
  const until = new Date(`${today}T12:00:00Z`);
  until.setUTCDate(until.getUTCDate() + days);
  const end = until.toISOString().slice(0, 10);
  const rows: { date: string; kind: string; school?: string; label: string; estimated: boolean }[] = [];
  for (const app of ws.tracker.apps) {
    const stage = statusInfo(app.status).stage;
    if (app.deadline && stage === "working") rows.push({ date: app.deadline, kind: "Deadline", school: app.name, label: `${app.name} application due`, estimated: false });
    if (stage === "working" || stage === "waiting") {
      const d = decisionDateOf(app, today);
      if (d) rows.push({ date: d.date, kind: "Decision", school: app.name, label: `${app.name} decision${d.estimated ? " (estimated from last year)" : ""}`, estimated: d.estimated });
    }
  }
  for (const d of ws.criticalDates) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) rows.push({ date: d.date, kind: "Date", label: d.label, estimated: false });
  }
  return rows.filter((r) => r.date >= today && r.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}
