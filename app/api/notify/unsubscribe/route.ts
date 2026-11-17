import type { NextRequest } from "next/server";
import { readUnsubscribeToken } from "@/lib/notify/send";
import { setEmails } from "@/lib/tracker-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Emails off</title>
<style>body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:#f6f7f9;color:#1b2333}main{max-width:480px;margin:15vh auto;padding:0 16px}a{color:#16705e}</style></head>
<body><main><h1 style="font-size:22px">Forge won't email you about portal changes.</h1><p>Turn them back on from the Applications tab in <a href="/hub/index.html#applications">Forge</a>.</p></main></body></html>`;

/**
 * The one-click "turn these emails off" link. A bad token gets the same page and changes nothing, so the
 * link can't be used to tell which workspaces exist.
 */
export async function GET(req: NextRequest) {
  const workspaceId = readUnsubscribeToken(req.nextUrl.searchParams.get("t") ?? "");
  if (workspaceId) {
    try {
      await setEmails(workspaceId, false);
    } catch (err) {
      console.error("unsubscribe failed", err instanceof Error ? err.name : "unknown");
    }
  }
  return new Response(PAGE, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
