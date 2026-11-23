import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/workspace-cookie";
import { APP_GRANT_HEADER } from "@/lib/oauth";
import { readDevices, registerDevice, removeDevice, setPushEnabled, type DeviceList } from "@/lib/notify/devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * iPhones that get push notifications when an automatic check finds news. Registering only works from the
 * Forge app (the proxy adds the app's grant id), so a web session can't add or take over a phone.
 */

const json = (body: { success: boolean; data: unknown; error: string | null }, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const ok = (data: unknown) => json({ success: true, data, error: null });
const fail = (status: number, error: string) => json({ success: false, data: null, error }, status);

const token = z.string().regex(/^[0-9a-fA-F]{64,200}$/);
const Register = z.object({ token, environment: z.enum(["sandbox", "production"]) });
const Remove = z.object({ token });
const Prefs = z.object({ pushEnabled: z.boolean() });

const summary = (list: DeviceList) => ({ pushEnabled: list.pushEnabled, count: list.devices.length });

/** A sibling *.xanom.co page is same-site for the cookie, so writes also check Origin and need a JSON body. */
function crossSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin && origin !== process.env.FORGE_ORIGIN) return true;
  return !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

type Ctx = { workspaceId: string; sub: string; grantId: string | null };
const GRANT_ID = /^[A-Za-z0-9_-]{4,120}$/;

async function handle(req: NextRequest, run: (ctx: Ctx, body: unknown) => Promise<Response>) {
  const session = getSession(req);
  if (!session) return fail(401, "Sign in to get notifications.");
  if (req.method !== "GET" && crossSite(req)) return fail(403, "Not allowed.");
  const body = req.method === "GET" ? null : await req.json().catch(() => undefined);
  const grant = req.headers.get(APP_GRANT_HEADER);
  try {
    return await run({ workspaceId: session.workspaceId, sub: session.sub, grantId: grant && GRANT_ID.test(grant) ? grant : null }, body);
  } catch (err) {
    console.error("devices route failed", err instanceof Error ? err.name : "unknown");
    return fail(500, "Couldn't save that. Try again.");
  }
}

export const GET = (req: NextRequest) => handle(req, async ({ workspaceId }) => ok(summary(await readDevices(workspaceId))));

export const POST = (req: NextRequest) =>
  handle(req, async ({ workspaceId, sub, grantId }, body) => {
    if (!grantId) return fail(403, "Turn on notifications in the Forge app.");
    const parsed = Register.safeParse(body);
    if (!parsed.success) return fail(400, "Send a device token and environment (sandbox or production).");
    return ok(summary(await registerDevice(workspaceId, parsed.data.token, parsed.data.environment, { sub, grantId })));
  });

export const DELETE = (req: NextRequest) =>
  handle(req, async ({ workspaceId }, body) => {
    const parsed = Remove.safeParse(body);
    if (!parsed.success) return fail(400, "Send the device token to remove.");
    return ok(summary(await removeDevice(workspaceId, parsed.data.token)));
  });

export const PATCH = (req: NextRequest) =>
  handle(req, async ({ workspaceId }, body) => {
    const parsed = Prefs.safeParse(body);
    if (!parsed.success) return fail(400, "Send pushEnabled as true or false.");
    return ok(summary(await setPushEnabled(workspaceId, parsed.data.pushEnabled)));
  });
