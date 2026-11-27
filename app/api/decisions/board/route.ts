import { NextRequest } from "next/server";
import { NO_STORE, readOwnBoard } from "@/lib/decision-board-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: the Decision board for the visitor's own workspace (lib/decision-board.ts). Read only. */
export async function GET(req: NextRequest) {
  try {
    const own = await readOwnBoard(req);
    if (!own) return Response.json({ error: "Open your hub first so there is a workspace." }, { status: 400, headers: NO_STORE });
    return Response.json(own.board, { headers: NO_STORE });
  } catch (err) {
    console.error("decision board failed", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Couldn’t load the decision board." }, { status: 500, headers: NO_STORE });
  }
}
