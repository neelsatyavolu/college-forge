import { NextRequest } from "next/server";
import { NO_STORE, readOwnBoard } from "@/lib/decision-board-route";
import { decisionPlan } from "@/lib/decision-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: the chat request behind "Get my picks" (lib/decision-plan.ts). The client runs it with chat mode "decision". */
export async function GET(req: NextRequest) {
  try {
    const own = await readOwnBoard(req);
    if (!own) return Response.json({ error: "Open your hub first so there is a workspace." }, { status: 400, headers: NO_STORE });
    const step = decisionPlan(own.ws, own.board);
    if (!step) return Response.json({ error: "Picks need at least one school that admitted you." }, { status: 400, headers: NO_STORE });
    return Response.json({ step, fingerprint: own.board.fingerprint }, { headers: NO_STORE });
  } catch (err) {
    console.error("decision plan failed", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Couldn’t start the comparison." }, { status: 500, headers: NO_STORE });
  }
}
