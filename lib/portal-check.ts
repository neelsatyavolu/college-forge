import { collegeById } from "./catalog";
import { readLogins, type PortalLogin } from "./portal-logins";
import { getWorkspace, updateWorkspace } from "./store";
import { replaceApp, withResult, type PortalResult, type TrackedApp } from "./tracker";

/**
 * Portal checks. College Apps' Worker owns the sign-in engine for 330 school portals; Forge calls its
 * service-only endpoint with one login at a time. Nothing about the login is stored there.
 */

const COLLEGEAPPS_URL = "https://collegeapps.n3el.dev";
export const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
};

export type CheckPlan = { ok: true; url: string } | { ok: false; reason: string };

/** Every catalog school can be tried; a school added by link only if it's a Slate portal. */
export function planCheck(app: TrackedApp, login: PortalLogin | undefined): CheckPlan {
  const college = app.collegeId ? collegeById(app.collegeId) : undefined;
  if (!college && app.platform !== "slate") return { ok: false, reason: "This portal can't be checked automatically. Check it by hand." };
  const host = hostOf(app.portalUrl) ?? (college ? hostOf(college.loginUrl) : null);
  if (!host) return { ok: false, reason: "Add the portal link to check it automatically." };
  if (!login?.username || !login.password) return { ok: false, reason: "Save this portal's username and password to check it automatically." };
  return { ok: true, url: `https://${host}/apply/status` };
}

type Snapshot = Omit<PortalResult, "checkedAt" | "ok" | "error">;

async function callService(app: TrackedApp, url: string, login: PortalLogin): Promise<Snapshot> {
  const key = process.env.FORGE_SERVICE_KEY;
  if (!key) throw new Error("Portal checks aren't set up on this server.");
  const res = await fetch(`${COLLEGEAPPS_URL}/api/service/check`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ collegeId: app.collegeId, url, username: login.username, password: login.password }),
    signal: AbortSignal.timeout(55_000),
  });
  const body = (await res.json().catch(() => ({}))) as { snapshot?: Snapshot; error?: string };
  if (res.ok && body.snapshot) return body.snapshot;
  // 422 carries a message written for students ("This portal asks for a Duo push…"); anything else is ours.
  throw new Error(res.status === 422 && body.error ? body.error : "Checking that portal failed. Try again in a few minutes.");
}

export async function checkApp(app: TrackedApp, login: PortalLogin | undefined, now = Date.now()): Promise<PortalResult> {
  const failed = (error: string): PortalResult => ({ checkedAt: now, ok: false, error, statusText: "", checklist: [], update: "" });
  const plan = planCheck(app, login);
  if (!plan.ok) return failed(plan.reason);
  try {
    const snap = await callService(app, plan.url, login!);
    return {
      checkedAt: now,
      ok: true,
      error: "",
      statusText: snap.statusText,
      checklist: snap.checklist,
      update: snap.update,
      ...(snap.decisionDate ? { decisionDate: snap.decisionDate } : {}),
      ...(snap.round ? { round: snap.round } : {}),
    };
  } catch (err) {
    return failed(err instanceof Error ? err.message : "Couldn't check this portal.");
  }
}

export const isDue = (app: TrackedApp, now = Date.now()) =>
  !!app.login?.hasPassword && (!app.portal || now - app.portal.checkedAt >= CHECK_INTERVAL_MS);

/**
 * Checks the given applications (or every one with a saved login) a few at a time, then saves all
 * results in one workspace write. Returns the checked applications as saved.
 */
export async function runChecks(
  workspaceId: string,
  opts: { appIds?: string[]; onlyDue?: boolean; concurrency?: number } = {},
): Promise<TrackedApp[]> {
  const ws = await getWorkspace(workspaceId);
  const logins = await readLogins(workspaceId);
  const now = Date.now();
  const targets = ws.tracker.apps.filter(
    (a) => (opts.appIds ? opts.appIds.includes(a.id) : !!logins[a.id]) && (!opts.onlyDue || isDue(a, now)),
  );
  if (!targets.length) return [];
  const results = new Map<string, PortalResult>();
  const queue = [...targets];
  const worker = async () => {
    for (let app = queue.shift(); app; app = queue.shift()) results.set(app.id, await checkApp(app, logins[app.id]));
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, queue.length) }, worker));
  const saved = await updateWorkspace(workspaceId, (current) => {
    let tracker = current.tracker;
    for (const [id, result] of results) {
      const app = tracker.apps.find((a) => a.id === id);
      if (app) tracker = replaceApp(tracker, withResult(app, result));
    }
    return { ...current, tracker };
  });
  return saved.tracker.apps.filter((a) => results.has(a.id));
}
