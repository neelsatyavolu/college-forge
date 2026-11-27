import rankListModule from "@/public/hub/rank-list.js";
import { statusInfo, type TrackedApp } from "@/lib/tracker";

// The web List tab's ranking code (public/hub/rank-list.js), shared so the app and the site order schools the same way.
const rankListJs = rankListModule as unknown as RankListJs;

type Ranks = Record<string, unknown>;
type RankRow = { app: { id: string; name: string; round: string }; ranks: Ranks; avg: number | null };
type School = Record<string, unknown>;
type RankListJs = {
  rankList: (apps: RankRow["app"][], schools: School[], fallback: School[], extra: unknown, career: { id: number; rank: number }[] | null) => RankRow[];
  officialSchools: (data: unknown) => School[];
  rankSummary: (ranks: Ranks) => { text: string; title: string };
  copyText: (rows: RankRow[]) => string;
};

export type RankListRow = {
  id: string;
  name: string;
  /** 1-based place on the list; null for a school none of the rankings cover. */
  position: number | null;
  /** The weighted average rank, to one decimal; null when unranked. */
  average: number | null;
  /** "USN #12 · Niche #9 · …", or "Not ranked". */
  summary: string;
  /** The same ranks spelled out, for VoiceOver. */
  detail: string;
  /** "admitted", "committed", or null. */
  outcome: "admitted" | "committed" | null;
};

export type RankListView = { rows: RankListRow[]; copyText: string };

/**
 * The List tab for a set of applications: best weighted average rank first, unranked schools last.
 * `career` is the student's My path rank for each career-list school, or null to average the published lists only.
 */
export function buildRankListView(
  apps: TrackedApp[],
  careerData: { schools: School[] },
  officialData: unknown,
  career: { id: number; rank: number }[] | null,
): RankListView {
  const extra = (officialData as { extra?: unknown } | null)?.extra ?? null;
  const input = apps.map((a) => ({ id: a.id, name: a.name, round: a.round }));
  const ranked = rankListJs.rankList(input, careerData.schools, rankListJs.officialSchools(officialData), extra, career);
  const byId = new Map(apps.map((a) => [a.id, a]));
  const rows = ranked.map((r, i): RankListRow => {
    const app = byId.get(r.app.id);
    const summary = rankListJs.rankSummary(r.ranks);
    const admitted = app ? statusInfo(app.status).stage === "admitted" : false;
    return {
      id: r.app.id,
      name: r.app.name,
      position: r.avg == null ? null : i + 1,
      average: r.avg == null ? null : Math.round(r.avg * 10) / 10,
      summary: r.avg == null ? "Not ranked" : summary.text,
      detail: summary.title,
      outcome: admitted ? (app?.status === "committed" ? "committed" : "admitted") : null,
    };
  });
  return { rows, copyText: rankListJs.copyText(ranked) };
}
