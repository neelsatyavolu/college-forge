import { z } from "zod";
import {
  DEFAULT_WEIGHTS, PILLARS, PILLAR_LABELS, SWITCH_LABELS, createRanker,
  matchSchoolId, type CareerData, type CareerSchool, type Pillar, type RankedRow, type Student, type Weights,
} from "@/lib/career-ranking";
import { COLLEGES, logoUrl } from "@/lib/catalog";
import { expandAlias } from "@/lib/college-aliases";
import type { RankingsMe } from "@/lib/rankings-me";

/**
 * The career rankings as a finished list, for clients that don't run the ranker themselves (the iOS app).
 * Mirrors app/rankings/RankingsClient.tsx and CareerList.tsx: same tabs, same targets rule, same tags.
 */

export const RANKINGS_DEFAULT_FLAGS = { col: true, va: false, stretch: false };

const weightsSchema = z.object(Object.fromEntries(PILLARS.map((k) => [k, z.number().min(0).max(100)])) as Record<Pillar, z.ZodNumber>)
  .refine((w) => PILLARS.some((k) => w[k] > 0));

export const rankingsViewInput = z.object({
  view: z.string().max(40).default("path"),
  weights: weightsSchema.optional(),
  flags: z.object({ col: z.boolean(), va: z.boolean(), stretch: z.boolean() }).optional(),
  /** Majors the student wants; empty or missing means the profile's intended majors, else every major. */
  targets: z.array(z.string().max(40)).max(20).optional(),
});
export type RankingsViewInput = z.infer<typeof rankingsViewInput>;

const NOTES: Record<Pillar, string> = {
  pay: "Median pay 1 to 7 years out in the major counted here, against the same major at the other schools.",
  wealth: "Top-quarter pay 10 years in, and the share of students from middle- and upper-income families who reach the top 1%.",
  rep: "U.S. News, QS employer survey, LinkedIn career outcomes, Wall Street and Big Tech hiring, and finance and tech jobs nearby.",
  jobs: "Share of graduates working or in school, and the graduation rate.",
  floor: "Bottom-quarter pay 10 years in.",
  campus: "Niche's campus, dorm and food grades, with their cost share taken out.",
};

/** How a measure compares with the other ranked schools, from its z-score (CareerList.tsx). */
function standing(z: number | null): { word: string; percentile: number | null } {
  if (z == null) return { word: "No data", percentile: null };
  const p = Math.round(100 / (1 + Math.exp(-1.7 * z)));
  return { word: z >= 1 ? "Strong" : z >= 0.35 ? "Good" : z > -0.35 ? "Average" : z > -1 ? "Weak" : "Very weak", percentile: p };
}

/** The catalog logo for a ranked school, matched by name. */
const logoOf = (s: CareerSchool) => {
  const c = COLLEGES.find((c) => matchSchoolId(c.name, [s], expandAlias(c.name)) === s.id);
  return c ? logoUrl(c.id) ?? null : null;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: number | null | undefined) => (isNum(v) ? v : null);

export function buildRankingsView(data: CareerData, me: RankingsMe, input: RankingsViewInput) {
  const ranker = createRanker(data);
  const weights: Weights = input.weights ?? { ...DEFAULT_WEIGHTS };
  const flags = input.flags ?? { ...RANKINGS_DEFAULT_FLAGS };
  const majors = data.meta.majors.filter((m) => m.target);
  const all = majors.map((m) => m.key);
  const admitted = new Set(me.schools.filter((s) => s.admitted).map((s) => s.id));

  const picked = (input.targets ?? []).filter((k) => all.includes(k));
  const from = picked.length ? picked : me.intended.length ? me.intended : all;
  const ok = from.filter((k) => all.includes(k));
  const targets = ok.length ? ok : all;
  const student: Student = {
    targets,
    direct: Object.fromEntries(
      me.schools.map((s) => [s.id, s.major.filter((k) => targets.includes(k))] as const).filter(([, k]) => k.length > 0),
    ),
  };

  const tabs = [
    { id: "path", label: "My path" },
    ...(admitted.size ? [{ id: "admitted", label: "Admitted" }] : []),
    ...(me.ai ? [{ id: "ai", label: "AI My Path" }] : []),
    { id: "overall", label: "All majors" },
    ...majors.map((m) => ({ id: m.key, label: m.tab || m.label })),
  ];
  const active = tabs.some((t) => t.id === input.view) ? input.view : "path";
  const isAi = active === "ai", isAdmitted = active === "admitted", isPath = active === "path" || isAdmitted;
  const title = isAi ? "Your judged list" : isAdmitted ? "Schools you got into" : isPath ? "Ranked by the majors you can reach"
    : active === "overall" ? "Ranked on all majors" : `Ranked on ${majors.find((m) => m.key === active)?.label.toLowerCase()}`;

  const base = {
    total: data.schools.length,
    generated: data.meta.generated,
    signedIn: me.account,
    hasWorkspace: me.workspace,
    view: active,
    title,
    tabs,
    majors: majors.map((m) => ({ key: m.key, label: m.label })),
    targets,
    weights,
    flags,
    defaults: { weights: DEFAULT_WEIGHTS, flags: RANKINGS_DEFAULT_FLAGS },
    pillars: PILLARS.map((k) => ({ key: k, label: PILLAR_LABELS[k][0], sub: PILLAR_LABELS[k][1], note: NOTES[k] })),
  };

  if (isAi && me.ai) {
    const st = { track: "path", ...RANKINGS_DEFAULT_FLAGS, w: { ...DEFAULT_WEIGHTS } };
    const formula = new Map(ranker.rank(st, student).map((r) => [r.s.id, r.rk]));
    const byName = new Map(data.schools.map((s) => [s.name.trim().toLowerCase(), s]));
    return {
      ...base,
      rows: [],
      missing: [],
      ai: {
        about: me.ai.about,
        made: me.ai.made,
        list: me.ai.list.map((x) => {
          const s = byName.get(x.school.trim().toLowerCase());
          return {
            rank: x.rank, school: s?.name ?? x.school, why: x.why, id: s?.id ?? null, logo: s ? logoOf(s) : null,
            place: s ? `${s.city}, ${s.state}` : null, formula: s ? formula.get(s.id) ?? null : null,
            admitted: !!s && admitted.has(s.id),
          };
        }),
      },
    };
  }

  const st = { track: isPath ? "path" : active, ...flags, w: weights };
  const rows = ranker.rank(st, student, isAdmitted ? admitted : undefined);
  const pathRanks = isAdmitted ? new Map(ranker.rank(st, student).map((r) => [r.s.id, r.rk])) : null;
  const tot = PILLARS.reduce((a, k) => a + weights[k], 0) || 1;
  const label = (k: string, r: RankedRow) => (isPath && !r.mx.direct && r.s.switch.lbl[k]) || majors.find((m) => m.key === k)?.short || "All majors";
  const missing = isPath ? [] : data.schools.filter((s) => !ranker.has(s, active)).map((s) => s.name);

  return {
    ...base,
    ai: null,
    missing,
    rows: rows.map((r) => {
      const s = r.s;
      const counted = r.mx.home ? "All majors" : label(r.mx.parts[0].k, r);
      const notes = [
        pathRanks ? `My path ${pathRanks.get(s.id)} of ${pathRanks.size}` : "",
        isPath ? (r.mx.none ? "doesn’t offer your majors, scored on all majors" : r.mx.home ? "no easy switch, scored on all majors" : `${counted}${r.mx.direct ? " (applied)" : ""}${r.mx.also?.length ? " · beats " + r.mx.also.slice(0, 3).map((k) => label(k, r)).join(", ") + (r.mx.also.length > 3 ? ` and ${r.mx.also.length - 3} more` : "") : ""}`) : "",
        r.obs < 0.5 ? "thin pay data" : "",
      ].filter(Boolean);
      return {
        id: s.id,
        name: s.name,
        logo: logoOf(s),
        place: `${s.city}, ${s.state}`,
        rank: r.rk,
        best: r.best,
        worst: r.worst,
        score: r.score,
        admitted: admitted.has(s.id),
        notes,
        counted,
        pay4: num(r.pay4),
        top1: s.oi?.system ? num(s.oi.top1_ctl) : num(r.top1),
        top1System: s.oi?.system ? s.oi.name ?? "the state system" : null,
        usNews: s.usn?.rank ?? null,
        usNewsLac: !!s.usn?.lac,
        niche: s.niche?.rank ?? null,
        forbes: s.forbes ?? null,
        measures: PILLARS.map((k) => ({ key: k, share: Math.round((100 * weights[k]) / tot), ...standing(r.z[k]) })),
        facts: {
          topQuarter: num(s.p75_10), bottomQuarter: num(s.p25_10), idle: num(r.idle), grad: num(s.grad), admit: num(s.admit),
          campus: s.niche?.campus ?? null, dorms: s.niche?.dorms ?? null, food: s.niche?.food ?? null,
        },
        switches: isPath ? targets.filter((k) => s.switch.lv[k] != null || !!s.tracks[k]).map((k) => {
          const lv = s.switch.lv[k];
          return { name: s.switch.lbl[k] || majors.find((m) => m.key === k)?.label || k, how: lv == null ? SWITCH_LABELS.unchecked : lv ? SWITCH_LABELS[String(lv)] ?? "unknown" : "not counted" };
        }) : [],
      };
    }),
  };
}
