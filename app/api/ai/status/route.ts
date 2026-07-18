import { resolveProviderStatus } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await resolveProviderStatus();
  // no-store is essential: this reflects live OAuth session cookies. A cached
  // "connected" response outlives an expired/cleared session, so the composer
  // stays enabled and the chat then fails with "No AI provider available".
  //
  // NOTE: built with `new Response(...)`, not `Response.json(data, init)` —
  // the latter silently drops these headers in this Next runtime (verified:
  // /api/workspace sets no-store this way, the Response.json version did not).
  return new Response(JSON.stringify(status), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, max-age=0",
    },
  });
}
