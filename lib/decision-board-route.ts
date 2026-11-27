import type { NextRequest } from "next/server";
import careerData from "@/public/data/career-ranking.json";
import officialData from "@/public/data/official-rankings.json";
import type { CareerData } from "@/lib/career-ranking";
import { decisionBoard, type DecisionBoardView } from "@/lib/decision-board";
import { peekWorkspace, type Workspace } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";

export const NO_STORE = { "cache-control": "no-store" };

/** The visitor's own workspace and its board, read only. Null when they have none yet (no workspace is created). */
export async function readOwnBoard(req: NextRequest): Promise<{ ws: Workspace; board: DecisionBoardView } | null> {
  const { id, setCookie } = await getWorkspaceId(req);
  if (setCookie) return null;
  const ws = await peekWorkspace(id);
  if (!ws) return null;
  return { ws, board: decisionBoard(ws, careerData as unknown as CareerData, officialData) };
}
