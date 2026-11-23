/**
 * Career rankings: scores schools on what graduates of the majors a student can reach go on to earn, how easily they
 * land work, how far the name carries, and campus life. Cost, aid and debt never count.
 *
 * Ported from the college-ranking project (build/app.js). The data is public/data/career-ranking.json, school facts only.
 * Everything personal (which majors a student wants, what they applied to, where they got in) is passed in per call.
 */

export type Pillar = "pay" | "wealth" | "rep" | "jobs" | "floor" | "campus";
export type Weights = Record<Pillar, number>;

export const PILLARS: Pillar[] = ["pay", "wealth", "rep", "jobs", "floor", "campus"];
export const CAREER: Pillar[] = ["pay", "wealth", "rep", "jobs", "floor"];
export const DEFAULT_WEIGHTS: Weights = { pay: 20, wealth: 25, rep: 10, jobs: 10, floor: 10, campus: 25 };
export const PILLAR_LABELS: Record<Pillar, [string, string]> = {
  pay: ["Typical pay", "median, by major"],
  wealth: ["Getting rich", "top quarter, top 1%"],
  rep: ["Employer pull", "name, recruiting, jobs nearby"],
  jobs: ["Jobs", "landing work, finishing"],
  floor: ["Earnings floor", "bottom quarter"],
  campus: ["Campus life", "facilities, dorms, food"],
};
/** Switch levels: 1 open, 2 grade bar, 2.5 most applicants get in, 3 competitive, 4 long shot. 0 or missing: not counted. */
export const SWITCH_LABELS: Record<string, string> = { "1": "open", "2": "grade bar", "2.5": "most get in", "3": "competitive", "4": "long shot" };
/** Schools within this many score points of the first school in their group share a rank. */
export const TIE = 2.5;

type Year = "e1" | "e4" | "e5" | "e7";
export type Track = Partial<Record<Year | "n1" | "n4" | "n5" | "n7", number>> & {
  idle: number; rpp: number; n?: number; instate?: number; codes?: string[]; suppressed?: boolean;
};
export type MajorInfo = { key: string; label: string; tab: string | null; short: string; feeder: "bank" | "tech" | null; target: boolean };
type Feeder = { pts: number; rank?: number } | null;
export type CareerSchool = {
  id: number; name: string; full: string; city: string; state: string; admit: number;
  rpp_eff: number; idle: number; p25_10: number; p75_10: number; grad: number | null; roomboard: number | null;
  oi: { top1_ctl: number; system?: boolean; name?: string } | null;
  qs: number | null; usn: { rank: number | null; lac: boolean } | null; li: number | null; forbes: number | null;
  feed: { bank: Feeder; tech: Feeder }; near: number; sat_then: number | null; sat_now: number | null;
  cut: Record<"2.5" | "3", number>;
  niche: { overall?: string; campus?: string; dorms?: string; food?: string; rank?: number } | null;
  tracks: Record<string, Track>; ptracks: Record<string, Track>;
  switch: { lv: Record<string, number>; lbl: Record<string, string> };
};
export type CareerData = {
  meta: { gpa: Record<string, number>; generated: string; editions: Record<string, string>; majors: MajorInfo[] };
  schools: CareerSchool[];
};

/** "path" is the student's own ranking; "overall" uses all majors; any major key ranks that major alone. */
export type Settings = {
  track: string;
  /** Adjust for who gets in: compare pay with what the admit rate predicts. */
  va: boolean;
  /** Adjust pay for the local price level. */
  col: boolean;
  /** Count majors that need a competitive application. */
  stretch: boolean;
  w: Weights;
};
export type Student = {
  /** Majors the student wants to end up in (keys of meta.majors). */
  targets: string[];
  /** Scorecard id -> the target majors the student applies to directly there. */
  direct: Record<number, string[]>;
};
export type MixPart = { k: string; w: number };
export type Mix = { parts: MixPart[]; also?: string[]; home?: boolean; direct?: boolean };
export type RankedRow = {
  s: CareerSchool; mx: Mix; pay4: number | null; idle: number; obs: number; raw: number;
  best: number; worst: number; score: number; rk: string; z: Record<Pillar, number | null>; top1: number | null;
};

const YW: Record<Year, number> = { e1: 0.15, e4: 0.3, e5: 0.3, e7: 0.25 };
const YN = { e1: "n1", e4: "n4", e5: "n5", e7: "n7" } as const;
const KS = 30;
/** Share of the real dollar gap between majors that counts on My path. */
const CROSS = 0.3;
/** A major with no published pay is estimated, and the estimate counts one typical estimating error lower. */
const EST_LOW = 1;
/** Half of the SAT-predicted change in the top-1% share since about 2001 is applied. */
const T1_SAT = 0.5;
/** Cost share of the campus measure in Niche's grades, added back so cost never counts. */
const CAMP_COST = 0.07;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const clamp = (v: number | null) => (v == null ? null : Math.max(-2.5, Math.min(2.5, v)));
function zs(v: (number | null)[]): (number | null)[] {
  const x = v.filter((n): n is number => n != null);
  if (!x.length) return v.map(() => null);
  const m = mean(x), s = Math.sqrt(mean(x.map((n) => (n - m) ** 2))) || 1;
  return v.map((n) => (n == null ? null : (n - m) / s));
}
/** Weighted average of z-scored inputs; a missing input counts as average. */
function blend(cols: (number | null)[][], wts: number[]) {
  const Z = cols.map((c) => zs(c).map(clamp)), W = wts.reduce((a, b) => a + b, 0);
  return cols[0].map((_, i) => {
    let n = 0, c = 0;
    Z.forEach((z, j) => { const v = z[i]; if (v != null) { n += wts[j] * v; c++; } });
    return c ? n / W : null;
  });
}
/** Same, but scored only on the inputs a school has. */
function blendObs(cols: (number | null)[][], wts: number[]) {
  const Z = cols.map((c) => zs(c).map(clamp));
  return cols[0].map((_, i) => {
    let n = 0, d = 0;
    Z.forEach((z, j) => { const v = z[i]; if (v != null) { n += wts[j] * v; d += wts[j]; } });
    return d ? n / d : null;
  });
}
function resid(y: (number | null)[], x: number[]) {
  const pts = y.map((v, i) => [x[i], v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  const m1 = mean(pts.map((p) => p[0])), m2 = mean(pts.map((p) => p[1]));
  let a = 0, b = 0;
  pts.forEach(([u, v]) => { a += (u - m1) * (v - m2); b += (u - m1) ** 2; });
  const k = b ? a / b : 0;
  return y.map((v, i) => (v == null ? null : v - (m2 + k * (x[i] - m1))));
}
const ln = (v: number | null | undefined) => (v == null || v <= 0 ? null : Math.log(v));
function ranksOf(raw: number[]) {
  const r: number[] = [];
  raw.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).forEach(([, i], k) => { r[i] = k + 1; });
  return r;
}
function scoreWith(P: Record<Pillar, (number | null)[]>, n: number, w: Weights) {
  return Array.from({ length: n }, (_, i) => {
    let a = 0, d = 0;
    for (const k of PILLARS) { const v = P[k][i]; if (v != null && w[k] > 0) { a += w[k] * v; d += w[k]; } }
    return d ? a / d : 0;
  });
}

/** Map a free-text major ("Computer Science", "Econ", "Data Science") to the ranking's major keys. */
export function majorKeysOf(text: string | undefined | null): string[] {
  const t = (text || "").toLowerCase();
  const out: string[] = [];
  if (/\becon/.test(t)) out.push("econ");
  if (/business|financ|accounting|management|marketing|commerce/.test(t)) out.push("business");
  if (/computer|\bcs\b|software|computing|artificial intelligence|\bai\b|machine learning|informatics|information science/.test(t)) out.push("cs");
  if (/statistic|data science|data analytics/.test(t)) out.push("stats");
  if (/math/.test(t)) out.push("appmath");
  return out;
}

export function createRanker(data: CareerData) {
  const S0 = data.schools, GPA = data.meta.gpa;
  const MJ = data.meta.majors, TGT = MJ.filter((m) => m.target).map((m) => m.key);
  const FEED: Record<string, MajorInfo["feeder"]> = Object.fromEntries(MJ.map((m) => [m.key, m.feeder]));
  const has = (s: CareerSchool, k: string) => !!s.tracks[k] && !s.tracks[k].suppressed;
  const camp = (s: CareerSchool) => {
    const n = s.niche;
    return n && n.campus && n.dorms && n.food ? (GPA[n.campus] + 0.3 * GPA[n.dorms] + 0.3 * GPA[n.food]) / 1.6 : null;
  };
  const feedPts = (s: CareerSchool, k: string) => {
    const b = s.feed.bank ? s.feed.bank.pts : 0, t = s.feed.tech ? s.feed.tech.pts : 0;
    return FEED[k] === "tech" ? t : FEED[k] === "bank" ? b : (b + t) / 2;
  };
  const oiOf = (s: CareerSchool) => (s.oi && !s.oi.system ? s.oi : null);
  // Top-1% share brought forward from students who started around 2000 to today's intake.
  const TOP1 = (() => {
    const lt = (s: CareerSchool) => Math.log(oiOf(s)!.top1_ctl);
    const F = S0.filter((s) => oiOf(s) && oiOf(s)!.top1_ctl > 0 && s.sat_then);
    const mx = mean(F.map((s) => s.sat_then!)), my = mean(F.map(lt));
    let a = 0, b = 0;
    F.forEach((s) => { a += (s.sat_then! - mx) * (lt(s) - my); b += (s.sat_then! - mx) ** 2; });
    const sl = b > 0 ? a / b : 0;
    const C = S0.filter((s) => s.sat_then && s.sat_now), dm = C.length ? mean(C.map((s) => s.sat_now! - s.sat_then!)) : 0;
    return new Map(S0.filter(oiOf).map((s) => [s.id, oiOf(s)!.top1_ctl * Math.exp(T1_SAT * sl * (s.sat_then && s.sat_now ? s.sat_now - s.sat_then - dm : 0))]));
  })();

  function pillars(st: Settings, stu: Student) {
    const path = st.track === "path";
    const dfl = (v: number, r: number) => v / (st.col ? r / 100 : 1);
    // On My path, a program reached by switching may be a narrower one (reach programs); a direct applicant gets the whole major.
    const L = path
      ? S0.map((s) => {
          const p = Object.fromEntries(Object.entries(s.ptracks).filter(([k]) => !(stu.direct[s.id] ?? []).includes(k)));
          return Object.keys(p).length ? { ...s, tracks: { ...s.tracks, ...p } } : s;
        })
      : S0;
    const S = path ? L : L.filter((s) => has(s, st.track));
    const PAYOK: Record<string, boolean> = {};
    const majorPay = (k: string) => {
      const la = (s: CareerSchool) => Math.log(s.admit);
      const acc = new Map(L.map((s) => [s.id, { dev: 0, dw: 0, prior: {} as Record<string, number>, est: {} as Record<string, number> }]));
      const used: Year[] = [];
      for (const y of Object.keys(YW) as Year[]) {
        const pts = L.filter((s) => has(s, k) && s.tracks[k][y]).map((s) => ({
          s, v: Math.log(dfl(s.tracks[k][y]!, s.tracks[k].rpp)), n: k === "overall" ? 1e9 : s.tracks[k][YN[y]] || 0,
        }));
        if (pts.length < 8) continue;
        used.push(y);
        const mx = mean(pts.map((p) => la(p.s))), my = mean(pts.map((p) => p.v));
        let a = 0, b = 0;
        pts.forEach((p) => { a += (la(p.s) - mx) * (p.v - my); b += (la(p.s) - mx) ** 2; });
        const sl = a / b, obs = new Map(pts.map((p) => [p.s.id, p]));
        L.forEach((s) => {
          const o = acc.get(s.id)!, prior = my + sl * (la(s) - mx), p = obs.get(s.id);
          o.prior[y] = prior;
          if (p) { const d = ((p.v - prior) * p.n) / (p.n + KS); o.est[y] = prior + d; o.dev += YW[y] * d; o.dw += YW[y]; }
        });
      }
      const tw = used.reduce((a, y) => a + YW[y], 0);
      return new Map(L.map((s) => {
        const o = acc.get(s.id)!;
        let v = 0, e = 0;
        const yr: Record<string, number | null> = {};
        used.forEach((y) => { v += YW[y] * (o.est[y] != null ? o.est[y] : o.prior[y]); e += YW[y] * o.prior[y]; yr[y] = o.est[y] ?? null; });
        return [s.id, { pay: tw ? v / tw : null, exp: tw ? e / tw : null, obs: tw ? o.dw / tw : 0, yr }];
      }));
    };
    const PAY: Record<string, ReturnType<typeof majorPay>> = {};
    [...TGT, "overall"].forEach((k) => { PAY[k] = majorPay(k); PAYOK[k] = PAY[k].get(L[0].id)!.pay != null; });
    const mu: Record<string, number> = {};
    TGT.filter((k) => PAYOK[k]).forEach((k) => { mu[k] = mean(L.map((s) => PAY[k].get(s.id)!.exp!)); });
    const lvl = mean(Object.values(mu));
    const ovr = (s: CareerSchool) => PAY.overall.get(s.id)!.pay;
    const gfull: Record<string, number> = {}, esd: Record<string, number> = {};
    Object.keys(mu).forEach((k) => {
      const both = L.filter((s) => PAY[k].get(s.id)!.obs > 0 && ovr(s) != null);
      const g = both.map((s) => PAY[k].get(s.id)!.pay! - ovr(s)!);
      gfull[k] = g.length ? mean(g) : 0;
      esd[k] = g.length ? Math.sqrt(mean(g.map((x) => (x - gfull[k]) ** 2))) : 0;
    });
    const payOf = (s: CareerSchool, k: string): number => {
      const p = PAY[k].get(s.id)!;
      if (!(k in mu) || p.obs > 0) return p.pay ?? 0;
      const o = ovr(s);
      return o != null ? o + gfull[k] - EST_LOW * esd[k] : mu[k];
    };
    const lev = (k: string) => (path && k in mu ? (1 - CROSS) * (mu[k] - lvl) : 0);
    const thr = st.stretch ? 3 : 2.5;
    // Which major counts for this school on My path: the reachable target whose graduates earn the most here.
    const mix = (s: CareerSchool): Mix => {
      const d = stu.direct[s.id] ?? [];
      const R = stu.targets.filter((k) => PAYOK[k] && (d.includes(k) || ((s.switch.lv[k] || 0) > 0 && s.switch.lv[k] <= thr)));
      if (!R.length) return { home: true, parts: [{ k: "overall", w: 1 }] };
      // A major with no published pay here only competes when no reachable major has published pay.
      const pub = R.filter((k) => PAY[k].get(s.id)!.obs > 0), U = pub.length ? pub : R;
      const best = U.slice().sort((x, y) => payOf(s, y) - lev(y) - (payOf(s, x) - lev(x)))[0];
      return { parts: [{ k: best, w: 1 }], also: pub.filter((k) => k !== best), direct: d.includes(best) };
    };
    const MX: Mix[] = S.map((s) => (path ? mix(s) : { parts: [{ k: st.track, w: 1 }] }));
    const wsum = (i: number, f: (k: string) => number) => MX[i].parts.reduce((a, p) => a + p.w * f(p.k), 0);
    let pay: (number | null)[] = S.map((s, i) => wsum(i, (k) => payOf(s, k) - lev(k)));
    const sel = S.map((s) => Math.log(s.admit));
    if (st.va) pay = resid(pay, sel);
    // A student who can't reach a money major at a school doesn't get that school's quarters lowered by programs that are
    // simply outside their plan; the cut is a school fact about money majors the school keeps closed.
    const cut = (s: CareerSchool) => (path ? s.cut[st.stretch ? "3" : "2.5"] : 0);
    let wealth = blendObs([S.map((s) => (ln(dfl(s.p75_10, s.rpp_eff)) ?? 0) + cut(s)), S.map((s) => (oiOf(s) ? TOP1.get(s.id)! : null))], [1, 1]);
    if (st.va) wealth = resid(wealth, sel);
    const qsVals = S.map((s) => s.qs).filter((v): v is number => v != null), qsLow = Math.min(...qsVals);
    const rep = blend([
      S.map((s) => (s.usn && s.usn.rank && !s.usn.lac ? -Math.log(s.usn.rank) : null)),
      S.map((s) => (s.qs != null ? s.qs : s.usn && s.usn.lac ? null : qsLow)),
      S.map((s) => (s.li ? 51 - s.li : 0)),
      S.map((s, i) => wsum(i, (k) => feedPts(s, k))),
      S.map((s) => Math.log1p(s.near)),
    ], [1, 1, 1, 1, 1]);
    const jobs = blend([S.map((s, i) => -wsum(i, (k) => (has(s, k) ? s.tracks[k].idle : s.idle))), S.map((s) => s.grad)], [1, 1]);
    const Z = (c: (number | null)[]) => zs(c).map(clamp);
    const cz = zs(S.map((s) => (s.niche && s.roomboard ? Math.log(s.roomboard) : null))), cmz = zs(S.map(camp));
    const campus = cmz.map((v, i) => (v == null ? null : v + CAMP_COST * (cz[i] || 0)));
    const P: Record<Pillar, (number | null)[]> = {
      pay: Z(pay), wealth: Z(wealth), rep: Z(rep), jobs: Z(jobs),
      floor: Z(S.map((s) => Math.log(dfl(s.p25_10, s.rpp_eff)) + cut(s))), campus: Z(campus),
    };
    return { S, P, MX, PAY, has, dfl };
  }

  /** Rank schools. `only` ranks just those ids (the Admitted view) on the full list's score scale. */
  function rank(st: Settings, stu: Student, only?: Set<number>): RankedRow[] {
    const { S, P, MX, PAY, has, dfl } = pillars(st, stu);
    const idx = S.map((_, i) => i).filter((i) => !only || only.has(S[i].id));
    const rk = (v: number[]) => { const r = ranksOf(idx.map((i) => v[i])), m: number[] = []; idx.forEach((i, j) => { m[i] = r[j]; }); return m; };
    const raw = scoreWith(P, S.length, st.w), base = rk(raw);
    // Sensitivity: re-rank with each career measure removed in turn.
    const alts = CAREER.filter((k) => st.w[k] > 0).map((k) => rk(scoreWith(P, S.length, { ...st.w, [k]: 0 })));
    const lo = Math.min(...raw), hi = Math.max(...raw);
    const pts = (v: number) => Math.round(hi > lo ? (100 * (v - lo)) / (hi - lo) : 50);
    const R = idx.map((i) => {
      const s = S[i], mx = MX[i], all = alts.length ? alts.map((a) => a[i]) : [base[i]];
      let a = 0, w = 0, idle = 0;
      mx.parts.forEach((p) => {
        const t = has(s, p.k) ? s.tracks[p.k] : null;
        if (t && t.e4) { a += p.w * Math.log(dfl(t.e4, t.rpp)); w += p.w; }
        idle += p.w * (t ? t.idle : s.idle);
      });
      return {
        s, mx, idle, raw: raw[i], score: pts(raw[i]), best: Math.min(...all), worst: Math.max(...all), rk: "",
        pay4: w ? Math.exp(a / w) : null,
        obs: mx.parts.reduce((x, p) => x + p.w * PAY[p.k].get(s.id)!.obs, 0),
        z: Object.fromEntries(PILLARS.map((k) => [k, P[k][i]])) as Record<Pillar, number | null>,
        top1: oiOf(s) ? TOP1.get(s.id)! : null,
      };
    }).sort((x, y) => y.raw - x.raw);
    // Ties: schools within TIE points of the first school in their group share a rank, shown as T-N.
    // The range under a rank starts from that shared rank, so a T-33 never shows a range of 36–37.
    for (let i = 0; i < R.length; ) {
      let j = i + 1;
      while (j < R.length && R[i].score - R[j].score < TIE) j++;
      for (let k = i; k < j; k++) {
        R[k].rk = j - i > 1 ? `T-${i + 1}` : `${i + 1}`;
        R[k].best = Math.min(R[k].best, i + 1);
        R[k].worst = Math.max(R[k].worst, i + 1);
      }
      i = j;
    }
    return R;
  }

  return { rank, majors: MJ, targets: TGT, has };
}

const norm = (v: string) =>
  v.toLowerCase().replace(/&/g, " and ").replace(/\b(the|suny|main campus|campus immersion)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
// Drops "university" only, so "Boston College" never matches Boston University.
const bare = (v: string) => norm(v).replace(/\buniversity\b/g, " ").replace(/\s+/g, " ").trim();

/**
 * The ranked school a name refers to ("Penn State University", "University of California, Davis", "UC Davis"),
 * or null. `canonical` is an optional expansion of an abbreviation (lib/college-aliases.ts).
 */
export function matchSchoolId(name: string, schools: Pick<CareerSchool, "id" | "name" | "full">[], canonical?: string | null): number | null {
  const tries = [name, canonical].filter((v): v is string => !!v);
  for (const f of [norm, bare]) {
    for (const t of tries) {
      const want = f(t);
      if (!want) continue;
      const hit = schools.find((s) => [s.name, s.full, s.full.split("-")[0]].some((n) => f(n) === want));
      if (hit) return hit.id;
    }
  }
  return null;
}
