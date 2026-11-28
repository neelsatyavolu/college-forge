/**
 * Copilot tools for the two ranking tabs: the Ranked list (the student's applications ordered by a weighted
 * average of the published rankings and their own career ranking) and Official rankings (the Forge ranking,
 * U.S. News, Forbes, Niche, WSJ and Princeton Review as published). Both read the same files and code the
 * tabs use, so the copilot's answer matches what the student sees.
 */
import careerData from "../public/data/career-ranking.json";
import officialData from "../public/data/official-rankings.json";
import rankListModule from "../public/hub/rank-list.js";
import type { ToolSpec } from "./chat-types";
import type { Workspace } from "./store";
import type { CareerData } from "./career-ranking";
import { pathRanks } from "./career-settings";
import { listInputs } from "./decision-board";
import { majorKeysOf } from "./career-ranking";
import { readCareerSettings } from "./career-settings";
import { buildRankListView } from "./rank-list-view";

type Entry = { rank: number; name: string; state?: string };
type Official = {
  editions: Record<string, string>;
  lists: Record<string, Entry[]>;
  extra: { schools?: { name: string; usn?: number; lac?: number; forbes?: number; niche?: number }[] };
};
const OFFICIAL = officialData as unknown as Official;
const RL = rankListModule as unknown as { matchSchool: (name: string, schools: { name: string; full: string }[]) => { name: string } | null; WEIGHTS: Record<string, number> };

const LISTS: Record<string, string> = {
  forge: "Forge ranking (weighted average of the published lists)",
  usn: "U.S. News National Universities",
  lac: "U.S. News National Liberal Arts Colleges",
  forbes: "Forbes America's Top Colleges",
  niche: "Niche Best Colleges",
  wsj: "WSJ/College Pulse Best Colleges",
  prPublic: "Princeton Review Best Value (public)",
  prPrivate: "Princeton Review Best Value (private)",
};

export const RANKING_TOOL_SPECS: ToolSpec[] = [
  {
    name: "get_ranked_list",
    description:
      "The Ranked list tab: the student's applications (Portals/Progress, not the shortlist) ordered best first by a weighted average of their U.S. News, Forbes, Niche, WSJ and Princeton Review ranks and the student's own career ranking (My path). It measures reputation and outcomes, not admission chances. Use it when the student asks about the Ranked list, the order of their schools, or why one school sits above another.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_official_rankings",
    description:
      "The Official rankings tab. Pass schools (names) to get each one's rank on every list, or list (forge, usn, lac, forbes, niche, wsj, prPublic, prPrivate) and top (1-100, default 25) for that list's top schools as published.",
    parameters: {
      type: "object",
      properties: {
        schools: { type: "array", items: { type: "string" }, maxItems: 20 },
        list: { type: "string", enum: Object.keys(LISTS) },
        top: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
];

/** The Ranked list as the tab shows it, for this workspace. */
export function rankedList(ws: Workspace) {
  const data = careerData as unknown as CareerData;
  const apps = ws.tracker.apps;
  const me = { intended: majorKeysOf(ws.profile.intended), settings: readCareerSettings(ws.careerSettings), schools: listInputs(ws, data.schools) };
  const career = apps.length ? pathRanks(data, me) : null;
  return buildRankListView(apps, careerData as unknown as { schools: Record<string, unknown>[] }, officialData, career);
}

const asSchools = (rows: { name: string }[]) => rows.map((r) => ({ ...r, full: r.name }));

/** One school's rank on every official list it appears on. */
export function officialRanksOf(name: string): { school: string; ranks: Record<string, number> } | null {
  const ranks: Record<string, number> = {};
  let school: string | null = null;
  const merged = OFFICIAL.extra.schools ?? [];
  const hit = RL.matchSchool(name, asSchools(merged)) as (typeof merged)[number] | null;
  if (hit) {
    school = hit.name;
    for (const k of ["usn", "lac", "forbes", "niche"] as const) if (hit[k]) ranks[k] = hit[k]!;
  }
  for (const [key, entries] of Object.entries(OFFICIAL.lists)) {
    if (ranks[key]) continue;
    const e = RL.matchSchool(name, asSchools(entries)) as (Entry & { full: string }) | null;
    if (e) { ranks[key] = e.rank; school ??= e.name; }
  }
  return school ? { school, ranks } : null;
}

export async function runRankingTool(name: string, a: Record<string, unknown>, read: () => Promise<Workspace>): Promise<string | null> {
  if (name === "get_ranked_list") {
    const view = rankedList(await read());
    if (!view.rows.length) return "The Ranked list is empty: it lists the student's applications (Portals/Progress), and they have none yet.";
    return JSON.stringify({
      how: `Applications ordered by a weighted average rank (weights ${JSON.stringify(RL.WEIGHTS)}; usn = U.S. News national, a liberal arts rank converted to its national equivalent; pr = Princeton Review Best Value, converted; career = the student's My path career ranking, converted). Lower is better. It is not an admission-chance order: a school high on this list can still be a reach.`,
      rows: view.rows.map((r) => ({ position: r.position, name: r.name, average: r.average, ranks: r.detail, outcome: r.outcome })),
    });
  }
  if (name === "get_official_rankings") {
    const schools = Array.isArray(a.schools) ? a.schools.filter((s): s is string => typeof s === "string" && !!s.trim()).slice(0, 20) : [];
    if (schools.length) {
      return JSON.stringify({
        lists: LISTS, editions: OFFICIAL.editions,
        schools: schools.map((s) => officialRanksOf(s) ?? { school: s, ranks: {}, note: "not on any official list Forge has" }),
      });
    }
    const list = typeof a.list === "string" && LISTS[a.list] ? a.list : "forge";
    const top = Math.min(100, Math.max(1, Number.isInteger(a.top) ? (a.top as number) : 25));
    return JSON.stringify({ list: LISTS[list], top: (OFFICIAL.lists[list] ?? []).slice(0, top).map((e) => ({ rank: e.rank, name: e.name, state: e.state })) });
  }
  return null;
}
