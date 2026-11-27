import { inboxStatus, setInbox } from "@/lib/inbox";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/workspace-cookie";
import { runChecks } from "@/lib/portal-check";
import { ImportError } from "@/lib/collegeapps-import";
import { allow } from "@/lib/rate-limit";
import { STATUS_IDS, ROUNDS } from "@/lib/tracker";
import { TEST_METHODS, TEST_PLANS } from "@/lib/testing-plan";
import { INTEREST_KINDS } from "@/lib/interest-log";
import { addInterestTo, updateInterest } from "@/lib/interest-service";
import {
  TrackerError,
  addApp,
  importFromCollegeApps,
  listApps,
  removeApp,
  reveal,
  getLetter,
  addLetterAward,
  setAutocheck,
  setEmails,
  setLogin,
  updateApp,
  viewApp,
  addFollowUpTo,
  updateFollowUp,
  flag,
  unflag,
  setSchedule,
  setMasterLogin,
  useMasterFor,
  applyMasterToAll,
  masterStatus,
  setupDetails,
} from "@/lib/tracker-service";
import { isTimeZone } from "@/lib/check-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

const date = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const edit = z.object({
  status: z.enum(STATUS_IDS).optional(),
  round: z.union([z.literal(""), z.enum(ROUNDS)]).optional(),
  deadline: date.optional(),
  decisionDate: date.optional(),
  notes: z.string().max(4000).optional(),
  decisionNote: z.string().max(1000).optional(),
  portalUrl: z.union([z.literal(""), z.string().max(500).regex(/^https:\/\//)]).optional(),
  name: z.string().max(120).optional(),
  submittedAt: date.optional(),
  ignoreAid: z.boolean().optional(),
  testing: z
    .object({
      plan: z.enum(TEST_PLANS).optional(),
      method: z.union([z.literal(""), z.enum(TEST_METHODS)]).optional(),
      officialSent: date.optional(),
      apSelfReported: z.boolean().optional(),
    })
    .strict()
    .optional(),
  // Amounts are checked by lib/aid-validate.ts (through editApp); null removes the offer.
  aidOffer: z.union([z.null(), z.object({
    costOfAttendance: z.union([z.number(), z.string().max(20)]).optional(),
    grants: z.union([z.number(), z.string().max(20)]).optional(),
    loans: z.union([z.number(), z.string().max(20)]).optional(),
    workStudy: z.union([z.number(), z.string().max(20)]).optional(),
    notes: z.string().max(2000).optional(),
    // Sent back by clients that echo a saved offer; the server sets its own time.
    updatedAt: z.number().optional(),
  }).strict()]).optional(),
});
const ref = z.string().min(1).max(200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const interestFields = {
  kind: z.enum(INTEREST_KINDS).optional(),
  date: day.optional(),
  time: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]).optional(),
  who: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
  prep: z.string().max(4000).optional(),
  thankYouSent: z.boolean().optional(),
  done: z.boolean().optional(),
};

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), name: z.string().max(120).optional(), collegeId: z.string().max(40).optional(), slug: z.string().max(120).optional(), portalUrl: z.string().max(500).optional() }).merge(edit.omit({ name: true, portalUrl: true })),
  z.object({ action: z.literal("update"), id: ref, edit }),
  z.object({ action: z.literal("remove"), id: ref }),
  z.object({ action: z.literal("reveal"), id: ref }),
  z.object({ action: z.literal("letter"), id: ref, letterId: z.string().regex(/^[a-f0-9]{32}$/).optional() }),
  z.object({ action: z.literal("award-add"), id: ref, index: z.number().int().min(0).max(9), letterId: z.string().regex(/^[a-f0-9]{32}$/).optional() }),
  z.object({ action: z.literal("login"), id: ref, username: z.string().max(254), password: z.string().max(256) }),
  z.object({ action: z.literal("forget-login"), id: ref }),
  z.object({ action: z.literal("autocheck"), on: z.boolean() }),
  z.object({ action: z.literal("emails"), on: z.boolean() }),
  z.object({ action: z.literal("inbox"), on: z.boolean().optional(), newAddress: z.boolean().optional(), birthdate: date.optional(), useMasterForNew: z.boolean().optional() }),
  z.object({
    action: z.literal("schedule"),
    everyHours: z.union([z.literal(8), z.literal(12), z.literal(24)]),
    startHour: z.number().int().min(0).max(23),
    timeZone: z.string().max(64).refine(isTimeZone, "Unknown time zone."),
  }),
  z.object({ action: z.literal("master-login"), username: z.string().max(254), password: z.string().min(1, "Enter the master password.").max(256) }),
  z.object({ action: z.literal("forget-master") }),
  z.object({ action: z.literal("use-master"), id: ref, on: z.boolean() }),
  z.object({ action: z.literal("apply-master-all") }),
  z.object({ action: z.literal("setup-details"), id: ref }),
  z.object({ action: z.literal("check"), ids: z.array(ref).max(100).optional() }),
  z.object({ action: z.literal("import-collegeapps"), email: z.string().max(254), password: z.string().max(256) }),
  z.object({ action: z.literal("followup-add"), id: ref, text: z.string().min(1).max(300), due: date.optional() }),
  z.object({ action: z.literal("followup-set"), id: ref, followUpId: z.string().max(40), done: z.boolean().optional(), remove: z.boolean().optional() }),
  z.object({ action: z.literal("interest-add"), id: ref, ...interestFields, kind: z.enum(INTEREST_KINDS), date: day }),
  z.object({ action: z.literal("interest-set"), id: ref, interestId: z.string().max(40), ...interestFields, remove: z.boolean().optional() }),
  z.object({ action: z.literal("flag-add"), text: z.string().min(1).max(500), scope: z.string().max(80).optional() }),
  z.object({ action: z.literal("flag-resolve"), flagId: z.string().max(40) }),
]);

function sameSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin || origin === process.env.FORGE_ORIGIN;
}

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return json({ success: false, error: "Sign in to see your applications.", signedOut: true }, 401);
  const [data, master] = await Promise.all([listApps(session.workspaceId), masterStatus(session.workspaceId)]);
  return json({ success: true, data, master });
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return json({ success: false, error: "Sign in first.", signedOut: true }, 401);
  if (!sameSite(req)) return json({ success: false, error: "Not allowed." }, 403);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);
  const ws = session.workspaceId;
  const b = parsed.data;
  try {
    switch (b.action) {
      case "add": {
        const { action: _a, ...input } = b;
        return json({ success: true, app: await addApp(ws, input), data: await listApps(ws) });
      }
      case "update":
        return json({ success: true, app: await updateApp(ws, b.id, b.edit), data: await listApps(ws) });
      case "remove":
        await removeApp(ws, b.id);
        return json({ success: true, data: await listApps(ws) });
      case "reveal":
        return json({ success: true, app: await reveal(ws, b.id), data: await listApps(ws) });
      case "letter":
        return json({ success: true, letter: await getLetter(ws, b.id, b.letterId) });
      case "award-add": {
        const r = await addLetterAward(ws, b.id, b.index, b.letterId);
        return json({ success: true, scholarship: r.scholarship, scholarships: r.scholarships, data: await listApps(ws) });
      }
      case "login":
        await setLogin(ws, b.id, { username: b.username, password: b.password });
        return json({ success: true, data: await listApps(ws) });
      case "forget-login":
        await setLogin(ws, b.id, null);
        return json({ success: true, data: await listApps(ws) });
      case "autocheck":
        return json({ success: true, data: await setAutocheck(ws, b.on) });
      case "emails":
        return json({ success: true, data: await setEmails(ws, b.on) });
      case "inbox":
        return json({
          success: true,
          inbox: b.on === undefined ? await inboxStatus(ws) : await setInbox(ws, { on: b.on, newAddress: b.newAddress, birthdate: b.birthdate, useMasterForNew: b.useMasterForNew }),
        });
      case "schedule":
        return json({ success: true, data: await setSchedule(ws, { everyHours: b.everyHours, startHour: b.startHour, timeZone: b.timeZone }) });
      case "master-login":
        return json({ success: true, master: await setMasterLogin(ws, { username: b.username, password: b.password }), data: await listApps(ws) });
      case "forget-master":
        return json({ success: true, master: await setMasterLogin(ws, null), data: await listApps(ws) });
      case "use-master":
        return json({ success: true, app: await useMasterFor(ws, b.id, b.on), master: await masterStatus(ws), data: await listApps(ws) });
      case "apply-master-all": {
        const r = await applyMasterToAll(ws);
        return json({ success: true, applied: r.applied, master: await masterStatus(ws), data: await listApps(ws) });
      }
      case "setup-details": {
        if (!(await allow(`setup-details:${session.sub}`, 30, 60 * 60 * 1000))) {
          return json({ success: false, error: "Too many tries. Wait an hour, then try again." }, 429);
        }
        return json({ success: true, setup: await setupDetails(ws, b.id) });
      }
      case "check": {
        if (!(await allow(`check:${session.sub}`, 120, 60 * 60 * 1000))) {
          return json({ success: false, error: "That's a lot of checks this hour. Forge keeps checking on its own schedule." }, 429);
        }
        const checked = await runChecks(ws, { appIds: b.ids });
        const data = await listApps(ws);
        return json({ success: true, checked: checked.map((a) => data.apps.find((v) => v.id === a.id) ?? viewApp(a)), data });
      }
      case "followup-add":
        return json({ success: true, app: await addFollowUpTo(ws, b.id, b.text, b.due ?? ""), data: await listApps(ws) });
      case "followup-set":
        return json({ success: true, app: await updateFollowUp(ws, b.id, b.followUpId, { done: b.done, remove: b.remove }), data: await listApps(ws) });
      case "interest-add": {
        const { action: _a, id, ...input } = b;
        return json({ success: true, app: await addInterestTo(ws, id, input), data: await listApps(ws) });
      }
      case "interest-set": {
        const { action: _a, id, interestId, ...edit } = b;
        return json({ success: true, app: await updateInterest(ws, id, interestId, edit), data: await listApps(ws) });
      }
      case "flag-add":
        return json({ success: true, data: await flag(ws, b.text, b.scope ?? "") });
      case "flag-resolve":
        return json({ success: true, data: await unflag(ws, b.flagId) });
      case "import-collegeapps": {
        if (!(await allow(`import:${session.sub}`, 5, 15 * 60 * 1000))) {
          return json({ success: false, error: "Too many tries. Wait 15 minutes, then try again." }, 429);
        }
        const r = await importFromCollegeApps(ws, b.email, b.password);
        return json({ success: true, added: r.added, linked: r.linked, total: r.total, data: r.tracker });
      }
    }
  } catch (err) {
    if (err instanceof TrackerError || err instanceof ImportError) return json({ success: false, error: err.message }, 400);
    console.error("applications action failed", b.action, err instanceof Error ? err.message : "unknown");
    return json({ success: false, error: "Something went wrong saving that. Try again." }, 500);
  }
}
