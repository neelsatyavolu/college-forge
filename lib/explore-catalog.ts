/**
 * The Explore tab's college list: public/data/explore-colleges.json (built by
 * scripts/explore/build-catalog.mjs from College Scorecard, U.S. News and Wikimedia Commons),
 * joined at load time with Forge's other sourced data: research notes, other publications'
 * ranks, international aid, nursing entry and Niche campus grades.
 */
import catalog from "../public/data/explore-colleges.json";
import official from "../public/data/official-rankings.json";
import career from "../public/data/career-ranking.json";
import type { College } from "./store";
import { isHttpUrl, slugify } from "./colleges";
import { aidsNoInternationals, internationalAid, internationalAidLabel } from "./international-aid";
import { nursingAdmission } from "./nursing-admission";
import { exploreNotes, researchFlagsFor, type ResearchFlags } from "./explore-notes";
import { SWITCH_LABELS } from "./career-ranking";

export type PhotoCredit = { by: string; license: string; page: string };

export type CatalogRow = {
  id: number; slug: string; name: string; alias?: string; city?: string; state?: string;
  region?: string; url?: string; control?: "public" | "private"; setting?: string; kind?: string;
  religious?: boolean; women?: boolean; men?: boolean; hbcu?: boolean;
  size?: number; admit?: number; testReq?: number; sat25?: number; sat75?: number; act25?: number; act75?: number;
  net?: number; coa?: number; tuitionIn?: number; tuitionOut?: number; grad?: number; earn?: number; pell?: number;
  rank?: number; lacRank?: number; gpa?: number;
  photo?: string; thumb?: string; credit?: PhotoCredit;
};

export const CATALOG: CatalogRow[] = (catalog as { colleges: CatalogRow[] }).colleges;
export const CATALOG_DATE: string = (catalog as { generatedAt: string }).generatedAt;
const BY_SLUG = new Map(CATALOG.map((c) => [c.slug, c]));
const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));

export function catalogRow(slugOrId: string | number | undefined | null): CatalogRow | undefined {
  if (typeof slugOrId === "number") return BY_ID.get(slugOrId);
  return slugOrId ? BY_SLUG.get(slugOrId) : undefined;
}

// ── Other publications' ranks (public/data/official-rankings.json) ───────────

export const LIST_LABELS = {
  usn: "U.S. News National",
  lac: "U.S. News Liberal Arts",
  forbes: "Forbes",
  niche: "Niche",
  wsj: "WSJ/College Pulse",
  prPublic: "Princeton Review, public",
  prPrivate: "Princeton Review, private",
  forge: "Forge career ranking",
} as const;
export type ListKey = keyof typeof LIST_LABELS;

type OfficialRow = { rank: number; name: string; facts?: { website?: string | null } };
const host = (u: string | null | undefined) => (u ? String(u).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase() : "");

const RANKS_BY_KEY = (() => {
  const byName = new Map<string, Partial<Record<ListKey, number>>>();
  const byHost = new Map<string, Partial<Record<ListKey, number>>>();
  const lists = (official as { lists: Record<string, OfficialRow[]> }).lists;
  for (const key of Object.keys(LIST_LABELS) as ListKey[]) {
    for (const row of lists[key] || []) {
      for (const [map, k] of [[byName, slugify(row.name)], [byHost, host(row.facts?.website)]] as const) {
        if (!k) continue;
        map.set(k, { ...(map.get(k) || {}), [key]: row.rank });
      }
    }
  }
  return { byName, byHost };
})();

export function ranksFor(c: Pick<CatalogRow, "name" | "slug" | "url">): Partial<Record<ListKey, number>> {
  return { ...(RANKS_BY_KEY.byHost.get(host(c.url)) || {}), ...(RANKS_BY_KEY.byName.get(slugify(c.name)) || RANKS_BY_KEY.byName.get(c.slug) || {}) };
}

// ── Niche grades and major-switching rules (public/data/career-ranking.json) ──

type CareerRow = {
  id: number;
  niche?: { overall?: string; campus?: string; dorms?: string; food?: string } | null;
  p25_10?: number; p75_10?: number;
  switch?: { lv: Record<string, number> };
  checked?: boolean;
};
const CAREER = (career as unknown as { schools: CareerRow[]; meta: { majors: { key: string; label: string }[] } });
const CAREER_BY_ID = new Map(CAREER.schools.map((s) => [s.id, s]));
const MAJOR_LABEL = new Map(CAREER.meta.majors.map((m) => [m.key, m.label]));

function campusAndSwitching(id: number) {
  const s = CAREER_BY_ID.get(id);
  if (!s) return {};
  const niche = s.niche && Object.values(s.niche).some(Boolean) ? s.niche : null;
  const switching = s.checked === false ? [] : Object.entries(s.switch?.lv || {})
    .filter(([, lv]) => lv > 0 && SWITCH_LABELS[String(lv)])
    .map(([key, lv]) => ({ major: MAJOR_LABEL.get(key) || key, level: lv, label: SWITCH_LABELS[String(lv)] }));
  const earnings = typeof s.p25_10 === "number" && typeof s.p75_10 === "number" ? { p25: s.p25_10, p75: s.p75_10 } : null;
  return { niche, switching, earningsRange: earnings };
}

// ── Rows for the Explore grid ───────────────────────────────────────────────

const pct = (n?: number) => (typeof n === "number" ? `${n < 0.1 ? (n * 100).toFixed(1).replace(/\.0$/, "") : Math.round(n * 100)}%` : undefined);
const money = (n?: number) => (typeof n === "number" ? `$${Math.round(n).toLocaleString("en-US")}` : undefined);
const range = (a?: number, b?: number) => (typeof a === "number" && typeof b === "number" ? `${a}–${b}` : undefined);
const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1) : undefined);

/** Facets the client filters and sorts on. Numbers stay raw; labels live on the College fields. */
export type Facets = ResearchFlags & {
  admit?: number; net?: number; size?: number; sat?: number; earn?: number; grad?: number;
  kind?: string; control?: string; region?: string; state?: string;
  intl?: "aid" | "none"; nursing?: string; hbcu?: boolean; women?: boolean; religious?: boolean;
  notes?: boolean; lists?: Partial<Record<ListKey, number>>;
};

const FLAGS = new Map<string, ResearchFlags & { notes: boolean }>();
function flagsFor(slug: string) {
  if (!FLAGS.has(slug)) {
    const f = researchFlagsFor(slug);
    FLAGS.set(slug, { ...f, notes: exploreNotes(slug) !== null });
  }
  return FLAGS.get(slug)!;
}

/** The test policy the grid shows: Forge's research first, then the Scorecard code. */
function testPolicy(c: CatalogRow, research?: ResearchFlags["testPolicy"]) {
  if (research) return research;
  if (c.testReq === 1) return "required";
  if (c.testReq === 5 || c.testReq === 2) return "optional";
  if (c.testReq === 3) return "blind";
  return undefined;
}

export function shortName(name: string): string {
  return name.replace(/^The\s+/i, "").replace(/\s*[-–—].*$/, "").slice(0, 28);
}

/** A catalog row as the hub's light College row plus filter facets. */
/** The photo credit is left to exploreExtras, which the school page loads. */
export function toExploreCollege(c: CatalogRow): College & { scorecardId: number; thumb?: string; lacRank?: number; f: Facets } {
  const place = [c.city, c.state].filter(Boolean).join(", ");
  const flags = flagsFor(c.slug);
  const aid = internationalAid(c.slug);
  const nursing = nursingAdmission(c.slug);
  const lists = ranksFor(c);
  const f: Facets = {
    ...flags,
    testPolicy: testPolicy(c, flags.testPolicy),
    admit: c.admit, net: c.net, size: c.size,
    sat: typeof c.sat25 === "number" && typeof c.sat75 === "number" ? Math.round((c.sat25 + c.sat75) / 2) : undefined,
    earn: c.earn, grad: c.grad, kind: c.kind, control: c.control, region: c.region, state: c.state,
    intl: aid ? (aidsNoInternationals(aid) ? "none" : "aid") : undefined,
    nursing: nursing?.entry ?? undefined,
    hbcu: c.hbcu, women: c.women, religious: c.religious,
    lists: Object.keys(lists).length ? lists : undefined,
  };
  return {
    slug: c.slug,
    name: c.name,
    short: shortName(c.name),
    location: c.setting ? `${place} · ${cap(c.setting)}` : place,
    setting: c.setting,
    rank: c.rank,
    lacRank: c.lacRank,
    admit: pct(c.admit),
    satRange: range(c.sat25, c.sat75),
    act: range(c.act25, c.act75),
    gpa: typeof c.gpa === "number" ? c.gpa.toFixed(2) : undefined,
    size: typeof c.size === "number" ? c.size.toLocaleString("en-US") : undefined,
    netPrice: money(c.net),
    photo: c.photo ?? null,
    thumb: c.thumb,
    scorecardId: c.id,
    f: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== false)) as Facets,
  } as College & { scorecardId: number; thumb?: string; lacRank?: number; f: Facets };
}

/** Catalog rows whose name, alias or city matches every word of the query, best first. */
export function searchCatalog(q: string, limit = 25): CatalogRow[] {
  const term = q.trim().toLowerCase();
  const words = term.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: [number, CatalogRow][] = [];
  for (const c of CATALOG) {
    const name = c.name.toLowerCase();
    const aliases = (c.alias || "").toLowerCase().split(/[|;,]/).map((a) => a.trim()).filter(Boolean);
    const hay = `${name} ${aliases.join(" ")} ${(c.city || "").toLowerCase()} ${(c.state || "").toLowerCase()}`;
    if (!words.every((w) => hay.includes(w))) continue;
    let s = 0;
    if (name === term || aliases.includes(term)) s += 1000;
    if (name.startsWith(term)) s += 300;
    if (aliases.some((a) => a.startsWith(term))) s += 200;
    if (name.includes(term)) s += 150;
    s += Math.min(60, Math.log10((c.size ?? 0) + 1) * 12);
    if (c.rank || c.lacRank) s += 20;
    scored.push([s, c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, c]) => c);
}

/** Everything Explore's school page adds on top of the Scorecard record. */
export function exploreExtras(slug: string, scorecardId?: number | null) {
  const row = catalogRow(slug) || (typeof scorecardId === "number" ? catalogRow(scorecardId) : undefined);
  const id = row?.id ?? scorecardId ?? null;
  const aid = internationalAid(row?.slug ?? slug);
  const nursing = nursingAdmission(row?.slug ?? slug);
  // Every link below renders as an <a href>: only http(s) survives.
  const link = (u: string | null | undefined) => (isHttpUrl(u) ? u : null);
  const research = exploreNotes(row?.slug ?? slug);
  return {
    photo: row?.photo ?? null,
    credit: row?.credit && link(row.credit.page) ? row.credit : null,
    lacRank: row?.lacRank ?? null,
    kind: row?.kind ?? null,
    region: row?.region ?? null,
    hbcu: row?.hbcu ?? false,
    women: row?.women ?? false,
    rankings: row ? ranksFor(row) : {},
    research: research && {
      ...research,
      notes: research.notes.filter((n) => link(n.sourceUrl)),
      byIncome: research.byIncome.map((b) => ({ ...b, sourceUrl: link(b.sourceUrl) })),
      deadlines: research.deadlines.map((d) => ({ ...d, sourceUrl: link(d.sourceUrl) })),
      essays: research.essays.map((e) => ({ ...e, sourceUrl: link(e.sourceUrl) })),
    },
    intlAid: aid ? { label: internationalAidLabel(aid), none: aidsNoInternationals(aid), source: link(aid.source) } : null,
    nursing: nursing ? { entry: nursing.entry, note: nursing.note, sourceUrl: link(nursing.sourceUrl) } : null,
    ...(typeof id === "number" ? campusAndSwitching(id) : {}),
  };
}
