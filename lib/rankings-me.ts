import type { NextRequest } from "next/server";
import data from "@/public/data/career-ranking.json";
import { majorKeysOf, matchSchoolId, type CareerData } from "@/lib/career-ranking";
import { expandAlias } from "@/lib/college-aliases";
import { ownerOf } from "@/lib/session";
import { parseCareerAi, type CareerAi } from "@/lib/career-ai";
import { readCareerSettings, type CareerSettings } from "@/lib/career-settings";
import { peekWorkspace, readCareerAiText, updateWorkspace } from "@/lib/store";
import { statusInfo, type TrackedApp } from "@/lib/tracker";
import { anonymousWorkspaceId, getSession } from "@/lib/workspace-cookie";

const SCHOOLS = (data as unknown as CareerData).schools;
export type RankingsMine = { id: number; major: string[]; admitted: boolean };
export type RankingsMe = {
  workspace: boolean; account: boolean; intended: string[]; schools: RankingsMine[]; ai: CareerAi | null;
  /** Majors, weights and adjustments the student saved (lib/career-settings.ts); null when none. */
  settings: CareerSettings | null;
};
export const NO_RANKINGS_ME: RankingsMe = { workspace: false, account: false, intended: [], schools: [], ai: null, settings: null };

/** The visitor's own workspace id: the signed-in account's, else an anonymous one no account has claimed. */
async function ownWorkspaceId(req: NextRequest): Promise<{ id: string | null; account: boolean }> {
  const session = getSession(req);
  const anon = session ? null : anonymousWorkspaceId(req);
  return { id: session?.workspaceId ?? (anon && !(await ownerOf(anon)) ? anon : null), account: !!session };
}

/**
 * Saves the visitor's career-ranking settings on their workspace. Never creates a workspace: false when the
 * visitor has none stored yet, so the settings only apply to this request.
 */
export async function saveRankingsSettings(req: NextRequest, settings: CareerSettings): Promise<boolean> {
  const { id } = await ownWorkspaceId(req);
  if (!id || !(await peekWorkspace(id))) return false;
  await updateWorkspace(id, (ws) => ({ ...ws, careerSettings: { ...(readCareerSettings(ws.careerSettings) ?? {}), ...settings } }));
  return true;
}

/** The applications on the visitor's own workspace, for the List tab; empty without one. Read only. */
export async function readOwnApps(req: NextRequest): Promise<TrackedApp[]> {
  const { id } = await ownWorkspaceId(req);
  if (!id) return [];
  const ws = await peekWorkspace(id);
  return ws?.tracker.apps ?? [];
}

/**
 * What the career rankings need from the visitor's own workspace: the majors they intend, the major on each
 * application, and which ranked schools admitted them. Only schools the ranking covers come back, as ids.
 * Read only: never creates or writes a workspace. A visitor without a stored one gets an empty answer.
 * A signed-in student also gets their own judged ranking, if they loaded one (lib/career-ai.ts).
 */
export async function readRankingsMe(req: NextRequest): Promise<RankingsMe> {
  const { id, account } = await ownWorkspaceId(req);
  if (!id) return NO_RANKINGS_ME;
  try {
    const ws = await peekWorkspace(id);
    if (!ws) return { ...NO_RANKINGS_ME, account };
    const bySlug = new Map(ws.colleges.map((c) => [c.slug, c]));
    const out = new Map<number, RankingsMine>();
    const add = (sid: number | null, major: string | undefined, admitted: boolean) => {
      if (sid == null || !SCHOOLS.some((s) => s.id === sid)) return;
      const prev = out.get(sid) ?? { id: sid, major: [], admitted: false };
      out.set(sid, { id: sid, major: [...new Set([...prev.major, ...majorKeysOf(major)])], admitted: prev.admitted || admitted });
    };
    const idOf = (name: string, scorecardId?: number) => scorecardId ?? matchSchoolId(name, SCHOOLS, expandAlias(name));
    for (const c of ws.colleges) add(idOf(c.name, c.scorecardId), c.major, false);
    for (const app of ws.tracker.apps) {
      const c = app.slug ? bySlug.get(app.slug) : undefined;
      add(idOf(c?.name ?? app.name, c?.scorecardId), c?.major, statusInfo(app.status).stage === "admitted");
    }
    const ai = account ? parseCareerAi(await readCareerAiText(id).catch(() => null)) : null;
    return { workspace: true, account, intended: majorKeysOf(ws.profile?.intended), schools: [...out.values()], ai, settings: readCareerSettings(ws.careerSettings) };
  } catch {
    return NO_RANKINGS_ME;
  }
}
