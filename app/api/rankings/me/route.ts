import { NextRequest } from "next/server";
import data from "@/public/data/career-ranking.json";
import { majorKeysOf, matchSchoolId, type CareerData } from "@/lib/career-ranking";
import { expandAlias } from "@/lib/college-aliases";
import { ownerOf } from "@/lib/session";
import { peekWorkspace } from "@/lib/store";
import { statusInfo } from "@/lib/tracker";
import { anonymousWorkspaceId, getSession } from "@/lib/workspace-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCHOOLS = (data as unknown as CareerData).schools;
const NONE = { workspace: false, intended: [] as string[], schools: [] as Mine[] };
type Mine = { id: number; major: string[]; admitted: boolean };

/**
 * What the career rankings page needs from the visitor's own workspace: the majors they intend, the major on each
 * application, and which ranked schools admitted them. Only schools the ranking covers come back, as ids.
 * Read only: never creates or writes a workspace. A visitor without a stored one gets an empty answer.
 */
export async function GET(req: NextRequest) {
  const headers = { "cache-control": "no-store" };
  const session = getSession(req);
  const anon = session ? null : anonymousWorkspaceId(req);
  const id = session?.workspaceId ?? (anon && !(await ownerOf(anon)) ? anon : null);
  if (!id) return Response.json(NONE, { headers });
  try {
    const ws = await peekWorkspace(id);
    if (!ws) return Response.json(NONE, { headers });
    const bySlug = new Map(ws.colleges.map((c) => [c.slug, c]));
    const out = new Map<number, Mine>();
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
    return Response.json({ workspace: true, intended: majorKeysOf(ws.profile?.intended), schools: [...out.values()] }, { headers });
  } catch {
    return Response.json(NONE, { headers });
  }
}
