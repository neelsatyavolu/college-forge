import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/workspace-cookie";
import { runChecks } from "@/lib/portal-check";
import { ImportError } from "@/lib/collegeapps-import";
import { allow } from "@/lib/rate-limit";
import { STATUS_IDS, ROUNDS } from "@/lib/tracker";
import {
  TrackerError,
  addApp,
  importFromCollegeApps,
  listApps,
  removeApp,
  reveal,
  setAutocheck,
  setLogin,
  updateApp,
  viewApp,
} from "@/lib/tracker-service";

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
  portalUrl: z.union([z.literal(""), z.string().max(500).regex(/^https:\/\//)]).optional(),
  name: z.string().max(120).optional(),
});
const ref = z.string().min(1).max(200);

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), name: z.string().max(120).optional(), collegeId: z.string().max(40).optional(), slug: z.string().max(120).optional(), portalUrl: z.string().max(500).optional() }).merge(edit.omit({ name: true, portalUrl: true })),
  z.object({ action: z.literal("update"), id: ref, edit }),
  z.object({ action: z.literal("remove"), id: ref }),
  z.object({ action: z.literal("reveal"), id: ref }),
  z.object({ action: z.literal("login"), id: ref, username: z.string().max(254), password: z.string().max(256) }),
  z.object({ action: z.literal("forget-login"), id: ref }),
  z.object({ action: z.literal("autocheck"), on: z.boolean() }),
  z.object({ action: z.literal("check"), ids: z.array(ref).max(100).optional() }),
  z.object({ action: z.literal("import-collegeapps"), email: z.string().max(254), password: z.string().max(256) }),
]);

function sameSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin || origin === process.env.FORGE_ORIGIN;
}

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return json({ success: false, error: "Sign in to see your applications.", signedOut: true }, 401);
  return json({ success: true, data: await listApps(session.workspaceId) });
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
      case "login":
        await setLogin(ws, b.id, { username: b.username, password: b.password });
        return json({ success: true, data: await listApps(ws) });
      case "forget-login":
        await setLogin(ws, b.id, null);
        return json({ success: true, data: await listApps(ws) });
      case "autocheck":
        return json({ success: true, data: await setAutocheck(ws, b.on) });
      case "check": {
        if (!(await allow(`check:${session.sub}`, 120, 60 * 60 * 1000))) {
          return json({ success: false, error: "That's a lot of checks this hour. Forge keeps checking on its own every 12 hours." }, 429);
        }
        const checked = await runChecks(ws, { appIds: b.ids });
        return json({ success: true, checked: checked.map((a) => viewApp(a)), data: await listApps(ws) });
      }
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
