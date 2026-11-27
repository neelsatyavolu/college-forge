import { z } from "zod";
import { applyArrival, lookupInbox, notPortal } from "@/lib/inbox";
import { fromCollegeAppsWorker } from "@/lib/service-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const token = z.string().regex(/^[a-z0-9]{20}$/);
const text = (max: number) => z.string().max(max);
const arrival = z.object({
  receivedAt: z.number(),
  collegeId: z.string().max(40).nullable(),
  name: text(160).min(1),
  portalUrl: z.union([z.literal(""), z.string().url().max(500).refine((u) => u.startsWith("https://"))]),
  username: text(254),
  password: text(256),
  state: z.enum(["verified", "set", "todo"]),
  pin: text(40),
  link: text(1000),
  reason: text(500),
  portal: z.unknown().optional(),
});
const input = z.discriminatedUnion("op", [
  // The school the email is about, read before the lookup, so the master password is offered only for its own hosts.
  // The Worker sends every URL it will type into; with none, no master. It must not type after a redirect off them.
  z.object({ op: z.literal("lookup"), token, collegeId: z.string().max(40).nullable().optional(), portalUrl: text(1000).optional(), link: text(1000).optional() }),
  z.object({ op: z.literal("arrival"), token, arrivalId: z.string().uuid(), final: z.boolean(), arrival }),
  z.object({ op: z.literal("not-portal"), token, subject: text(300) }),
]);

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  // Only the College Apps Worker calls this, with the same shared secret Forge uses to call it.
  if (!fromCollegeAppsWorker(req)) return json({ error: "Missing or wrong service key." }, 401);
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Bad request." }, 400);
  const b = parsed.data;
  try {
    if (b.op === "lookup") {
      const found = await lookupInbox(b.token, Date.now(), { collegeId: b.collegeId, portalUrl: b.portalUrl, link: b.link });
      return found ? json(found) : json({ error: "No such address." }, 404);
    }
    if (b.op === "arrival") {
      const { portal: _p, ...rest } = b.arrival;
      return (await applyArrival(b.token, b.arrivalId, rest, b.final)) ? json({ ok: true }) : json({ error: "No such address." }, 404);
    }
    return (await notPortal(b.token, b.subject)) ? json({ ok: true }) : json({ error: "No such address." }, 404);
  } catch (err) {
    console.error("service inbox failed", b.op, err instanceof Error ? err.name : "unknown");
    return json({ error: "Something went wrong on Forge's side." }, 500);
  }
}
