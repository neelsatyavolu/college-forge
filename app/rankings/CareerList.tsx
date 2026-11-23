import { useState } from "react";
import { PILLARS, PILLAR_LABELS, SWITCH_LABELS, type MajorInfo, type Pillar, type RankedRow, type Weights } from "@/lib/career-ranking";

const money = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v / 1000)}k`);
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const rankNo = (v: number | null | undefined, tag = "") => (v ? `#${v}${tag}` : "—");
/** How a measure compares with the other ranked schools, from its z-score. */
function standing(z: number | null): [string, number] {
  if (z == null) return ["No data", 0];
  const p = Math.round(100 / (1 + Math.exp(-1.7 * z)));   // logistic approximation of the normal percentile
  return [z >= 1 ? "Strong" : z >= 0.35 ? "Good" : z > -0.35 ? "Average" : z > -1 ? "Weak" : "Very weak", p];
}

const NOTES: Record<Pillar, string> = {
  pay: "Median pay 1 to 7 years out in the major counted here, against the same major at the other schools.",
  wealth: "Top-quarter pay 10 years in, and the share of students from middle- and upper-income families who reach the top 1%.",
  rep: "U.S. News, QS employer survey, LinkedIn career outcomes, Wall Street and Big Tech hiring, and finance and tech jobs nearby.",
  jobs: "Share of graduates working or in school, and the graduation rate.",
  floor: "Bottom-quarter pay 10 years in.",
  campus: "Niche's campus, dorm and food grades, with their cost share taken out.",
};

type Props = {
  rows: RankedRow[];
  weights: Weights;
  majors: MajorInfo[];
  path: boolean;
  targets: string[];
  admitted: Set<number>;
  pathRanks: Map<number, string> | null;
  col: boolean;
};

export default function CareerList({ rows, weights, majors, path, targets, admitted, pathRanks, col }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  // The school's own program name (e.g. Info Science) only when that program is what counts: reached by switching on My path.
  const label = (k: string, r: RankedRow) => (path && !r.mx.direct && r.s.switch.lbl[k]) || majors.find((m) => m.key === k)?.short || "All majors";
  return (
    <div className="rk-list rk-list--career" role="list" aria-label="Career ranking">
      <div className="rk-row rk-row--head" aria-hidden="true">
        <span>Rank</span>
        <span>College</span>
        <span title="0 to 100 on this list. 100 is the best school here, not a perfect school.">Score</span>
        <span title={`Median pay four years after graduating in the major counted${col ? ", adjusted for cost of living" : ""}`}>Pay, yr 4</span>
        <span title="Share of students from middle- and upper-income families who reach the top 1% of earners">Top 1%</span>
        <span title="U.S. News rank (LA: liberal arts list). Shown for comparison.">U.S. News</span>
        <span title="Niche Best Colleges rank. Shown, not scored.">Niche</span>
        <span title="Forbes America’s Top Colleges rank. Shown, not scored.">Forbes</span>
        <span />
      </div>
      {rows.map((r) => {
        const s = r.s, isOpen = open === s.id, id = `career-${s.id}`;
        const counted = r.mx.home ? "All majors" : label(r.mx.parts[0].k, r);
        const tags = [
          pathRanks ? `My path ${pathRanks.get(s.id)} of ${pathRanks.size}` : "",
          path ? (r.mx.home ? "no easy switch, scored on all majors" : `${counted}${r.mx.direct ? " (applied)" : ""}${r.mx.also?.length ? " · beats " + r.mx.also.map((k) => label(k, r)).join(", ") : ""}`) : "",
          r.obs < 0.5 ? "thin pay data" : "",
        ].filter(Boolean);
        return (
          <div role="listitem" key={s.id} className={"rk-item" + (isOpen ? " is-open" : "") + (admitted.has(s.id) ? " is-admitted" : "")}>
            <button type="button" className="rk-row" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpen(isOpen ? null : s.id)}>
              <span className="rk-rank">
                <span className="rk-rank__n">{r.rk}</span>
                {(r.best !== r.worst) && (
                  <span className="rk-rank__range" title="Where the school lands if any one career measure is dropped">{r.best}–{r.worst}</span>
                )}
              </span>
              <span className="rk-school">
                <span className="rk-school__name">
                  {s.name}
                  {admitted.has(s.id) && <span className="rk-badge">Admitted</span>}
                </span>
                <span className="rk-school__meta">{s.city}, {s.state}</span>
                {tags.length > 0 && <span className="rk-school__notes">{tags.join(" · ")}</span>}
              </span>
              <span className="rk-scorebar" aria-label={`Score ${r.score} of 100`}>
                <span className="rk-scorebar__track"><span className="rk-scorebar__fill" style={{ width: `${Math.max(3, r.score)}%` }} /></span>
                <span className="rk-scorebar__n">{r.score}</span>
              </span>
              <span className="rk-cell rk-num" data-label="Pay, yr 4">{money(r.pay4)}</span>
              <span className="rk-cell rk-num" data-label="Top 1%">{s.oi?.system ? `${pct(s.oi.top1_ctl)}*` : pct(r.top1)}</span>
              <span className="rk-cell rk-num" data-label="U.S. News">{rankNo(s.usn?.rank)}{s.usn?.lac && <sup>LA</sup>}</span>
              <span className="rk-cell rk-num" data-label="Niche">{rankNo(s.niche?.rank)}</span>
              <span className="rk-cell rk-num" data-label="Forbes">{rankNo(s.forbes)}</span>
              <span className="rk-chevron" aria-hidden="true">{isOpen ? "−" : "+"}</span>
            </button>
            {isOpen && <Detail id={id} r={r} weights={weights} majors={majors} targets={targets} path={path} counted={counted} />}
          </div>
        );
      })}
    </div>
  );
}

function Detail({ id, r, weights, majors, targets, path, counted }: { id: string; r: RankedRow; weights: Weights; majors: MajorInfo[]; targets: string[]; path: boolean; counted: string }) {
  const s = r.s, tot = PILLARS.reduce((a, k) => a + weights[k], 0) || 1;
  const sw = targets.map((k) => {
    const lv = s.switch.lv[k];
    return { k, name: s.switch.lbl[k] || majors.find((m) => m.key === k)?.label || k, how: lv ? SWITCH_LABELS[String(lv)] ?? "unknown" : "not counted" };
  });
  return (
    <div id={id} className="rk-detail">
      <div className="rk-metrics rk-metrics--six">
        {PILLARS.map((k) => {
          const [word, p] = standing(r.z[k]);
          return (
            <div className="rk-metric" key={k}>
              <div className="rk-metric__top">
                <span>{PILLAR_LABELS[k][0]}</span>
                <span className="rk-metric__weight">{Math.round((100 * weights[k]) / tot)}% of score</span>
              </div>
              <div className="rk-metric__value">{word}</div>
              <p>{NOTES[k]}</p>
              {r.z[k] != null && (
                <div className="rk-meter" title={`Better than about ${p}% of the schools here`}>
                  <span style={{ width: `${p}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <dl className="rk-context">
        <div><dt>Scored on</dt><dd>{counted}</dd></div>
        <div><dt>Top quarter, 10 years in</dt><dd>{money(s.p75_10)}</dd></div>
        <div><dt>Bottom quarter, 10 years in</dt><dd>{money(s.p25_10)}</dd></div>
        <div><dt>Not working or in school</dt><dd>{pct(r.idle)}</dd></div>
        <div><dt>Graduation rate</dt><dd>{pct(s.grad, 0)}</dd></div>
        <div><dt>Admit rate</dt><dd>{pct(s.admit, 0)}</dd></div>
        <div><dt>U.S. News · Niche · Forbes</dt><dd>{rankNo(s.usn?.rank, s.usn?.lac ? " liberal arts" : "")} · {rankNo(s.niche?.rank)} · {rankNo(s.forbes)} <span>(not scored)</span></dd></div>
        <div><dt>Campus · dorms · food</dt><dd>{s.niche?.campus ?? "—"} · {s.niche?.dorms ?? "—"} · {s.niche?.food ?? "—"}</dd></div>
      </dl>
      {path && sw.length > 0 && (
        <div className="rk-topmajors">
          <h4>Switching in after you enroll</h4>
          <ul>
            {sw.map((x) => <li key={x.k}>{x.name} <span>{x.how}</span></li>)}
          </ul>
        </div>
      )}
      {!!s.oi?.system && <p className="rk-detail__note">The top-1% figure covers the whole state system ({s.oi.name}), so it is shown but not scored.</p>}
    </div>
  );
}
