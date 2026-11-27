import { NextRequest } from "next/server";
import { exportCalendar } from "@/lib/export";
import { resolveFeed } from "@/lib/calendar-feed";
import { allow } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** Same reply for a malformed, unknown, rotated or revoked token: nothing about why. */
const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/**
 * The private calendar subscription (lib/calendar-feed.ts). Google and Apple Calendar fetch it without cookies,
 * so the token in the path is the only credential. Limited per feed, not per address: Google fetches many
 * people's calendars from the same few addresses.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  try {
    const ws = await resolveFeed(token);
    if (!ws) return notFound();
    if (!(await allow(`calendar-feed:${token}`, 60, 60 * 60 * 1000))) {
      return new Response("Too many requests", { status: 429, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "3600", "cache-control": "no-store" } });
    }
    // Families share this link, so the student's free-text notes stay out of it.
    return new Response(exportCalendar(ws, undefined, { notes: false }).text, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `inline; filename="college-forge.ics"`,
        "cache-control": "private, max-age=900",
        "x-robots-tag": "noindex",
      },
    });
  } catch (err) {
    console.error("calendar feed failed", err instanceof Error ? err.name : "unknown");
    return new Response("Try again later", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
}
