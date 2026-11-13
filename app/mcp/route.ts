import { verifyAccess } from "@/lib/oauth";
import { CORS, preflight } from "@/lib/oauth-http";
import { appOrigin } from "@/lib/origin";
import { callTool, toolList } from "@/lib/mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Forge's MCP server: Streamable HTTP, stateless, answering each POST with JSON (no SSE stream needed since
 * no tool sends progress). Every request must carry an OAuth access token from /oauth/token.
 */

const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
  "Forge tracks a student's college applications: status, rounds, deadlines, decision dates and what each school's portal says. " +
  "Use list_applications first. Statuses: planning (not started), in_progress (writing), submitted, complete (under review), deferred, waitlisted, admitted, committed, denied, withdrawn. " +
  "A decision a portal posted stays hidden until the student asks to see it; only then call reveal_decision. " +
  "Keep the progress page current: add schools, update statuses, add follow-ups (to-dos per school) and flags (problems across schools), and complete them when done. Dates are yyyy-mm-dd.";

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const rpcError = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg: Rpc, workspaceId: string): Promise<object | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid request");
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "forge", title: "Forge", version: "1.0.0", websiteUrl: "https://forge.xanom.co" },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id: msg.id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id: msg.id, result: { tools: toolList() } };
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      return { jsonrpc: "2.0", id: msg.id, result: await callTool(workspaceId, name, msg.params?.arguments) };
    }
    case "resources/list":
      return { jsonrpc: "2.0", id: msg.id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id: msg.id, result: { prompts: [] } };
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

function unauthorized(req: Request): Response {
  return new Response(JSON.stringify({ error: "invalid_token", error_description: "Connect Forge to get an access token." }), {
    status: 401,
    headers: {
      ...CORS,
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${appOrigin(req)}/.well-known/oauth-protected-resource/mcp", scope="applications"`,
    },
  });
}

export async function POST(req: Request) {
  const auth = await verifyAccess(req.headers.get("authorization"));
  if (!auth) return unauthorized(req);
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400, headers: CORS });
  }
  const replies = Array.isArray(body)
    ? (await Promise.all(body.map((m) => handle(m, auth.workspaceId)))).filter(Boolean)
    : [await handle(body, auth.workspaceId)].filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return Response.json(Array.isArray(body) ? replies : replies[0], { headers: { ...CORS, "cache-control": "no-store" } });
}

/** No server-initiated stream: clients fall back to plain request/response. */
export async function GET(req: Request) {
  if (!(await verifyAccess(req.headers.get("authorization")))) return unauthorized(req);
  return new Response("Method Not Allowed", { status: 405, headers: { ...CORS, allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { ...CORS, allow: "POST" } });
}

export const OPTIONS = preflight;
