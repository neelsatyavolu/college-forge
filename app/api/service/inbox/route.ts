import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { applyArrival, lookupInbox, notPortal } from "@/lib/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Only the College Apps Worker calls this, with the same shared secret Forge uses to call it. */
function authorized(req: Request): boolean {
  const secret = process.env.FORGE_SERVICE_KEY;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return !!secret && !!given && timingSafeEqual(digest(given), digest(secret));
}

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
  z.object({ op: z.literal("lookup"), token }),
  z.object({ op: z.literal("arrival"), token, arrivalId: z.string().uuid(), final: z.boolean(), arrival }),
  z.object({ op: z.literal("not-portal"), token, subject: text(300) }),
]);

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: "Missing or wrong service key." }, 401);
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Bad request." }, 400);
  const b = parsed.data;
  try {
    if (b.op === "lookup") {
      const found = await lookupInbox(b.token);
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
