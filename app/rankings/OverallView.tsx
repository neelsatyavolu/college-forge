import { useMemo, useState } from "react";
import { money, ordinalPct, rankFor, rate, signedPct } from "./format";
import { useJson } from "./hooks";
import { RankCell, SchoolName, ScoreBar } from "./parts";
import type { PriceMode, School, SchoolMajorsFile } from "./types";

type Props = {
  schools: School[];
  prices: PriceMode;
  onOpenMajor: (cip: string) => void;
};

const TYPICAL_EARNINGS_HELP =
  "Completion-weighted average of the median earnings of this college’s bachelor’s programs, mostly 4 years after graduating. Not the median of all graduates.";

export default function OverallView({ schools, prices, onOpenMajor }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="rk-list" role="list" aria-label="Overall career-outcomes ranking">
      <div className="rk-row rk-row--head" aria-hidden="true">
        <span>Rank</span>
        <span>College</span>
        <span title="Relative index: 100 is the top college, 0 the lowest. Not a probability.">Score</span>
        <span title="Early-career earnings compared with graduates of the same majors nationally">
          vs. same majors
        </span>
        <span title={TYPICAL_EARNINGS_HELP}>Typical early earnings</span>
        <span>Graduation</span>
        <span />
      </div>
      {schools.map((s) => (
        <OverallRow
          key={s.unitid}
          school={s}
          prices={prices}
          expanded={open === s.unitid}
          onToggle={() => setOpen((v) => (v === s.unitid ? null : s.unitid))}
          onOpenMajor={onOpenMajor}
        />
      ))}
    </div>
  );
}

type RowProps = { school: School; prices: PriceMode; expanded: boolean; onToggle: () => void; onOpenMajor: (cip: string) => void };

function OverallRow({ school: s, prices, expanded, onToggle, onOpenMajor }: RowProps) {
  const detailId = `school-${s.unitid}`;
  const r = rankFor(s, prices);
  const adjusted = prices === "adjusted";
  const score = adjusted ? s.score_adjusted : s.score;
  const premium = adjusted ? s.early_premium_adjusted_pct : s.early_premium_pct;
  return (
    <div role="listitem" className={"rk-item" + (expanded ? " is-open" : "")}>
      <button type="button" className="rk-row" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle}>
        <RankCell rank={r.rank} low={r.low} high={r.high} />
        <SchoolName name={s.institution} city={s.city} state={s.state} control={s.control} />
        <ScoreBar value={score} label={`Score ${score.toFixed(1)} on a 0 to 100 relative index`} />
        <span className="rk-cell rk-num" data-label="vs. same majors">
          <strong className={premium >= 0 ? "rk-pos" : "rk-neg"}>{signedPct(premium)}</strong>
        </span>
        <span className="rk-cell rk-num" data-label="Typical early earnings">{money(s.typical_earnings)}</span>
        <span className="rk-cell rk-num" data-label="Graduation">{rate(s.graduation_rate)}</span>
        <span className="rk-chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && <SchoolDetail id={detailId} school={s} prices={prices} onOpenMajor={onOpenMajor} />}
    </div>
  );
}

function SchoolDetail({ id, school: s, prices, onOpenMajor }: { id: string; school: School; prices: PriceMode; onOpenMajor: (cip: string) => void }) {
  const adjusted = prices === "adjusted";
  const costNote = adjusted ? "after cost of living" : "as reported";
  const metrics = [
    {
      label: "Early-career earnings",
      weight: "50% of score",
      value: signedPct(adjusted ? s.early_premium_adjusted_pct : s.early_premium_pct),
      note: `vs. graduates of the same majors nationally, ${costNote}; about four years after graduating`,
      pctile: adjusted ? s.early_premium_adjusted_pctile : s.early_premium_pctile,
    },
    { label: "Graduation", weight: "31% of score", value: rate(s.graduation_rate), note: "of first-time, full-time students finish within six years", pctile: s.graduation_pctile },
    { label: "Employment", weight: "19% of score", value: rate(s.employment_rate), note: "of graduates working three years out, among those not back in school", pctile: s.employment_pctile },
    {
      label: "Later earnings",
      weight: "not scored",
      value: money(s.earnings_10yr),
      note: `median about 6 years after graduating (10 after starting), including students who didn’t finish; ${signedPct(adjusted ? s.later_premium_adjusted_pct : s.later_premium_pct)} vs. what its majors predict`,
      pctile: null,
    },
  ];
  const other = rankFor(s, adjusted ? "nominal" : "adjusted");
  return (
    <div id={id} className="rk-detail">
      <div className="rk-metrics">
        {metrics.map((m) => (
          <div className="rk-metric" key={m.label}>
            <div className="rk-metric__top">
              <span>{m.label}</span>
              <span className="rk-metric__weight">{m.weight}</span>
            </div>
            <div className="rk-metric__value">{m.value}</div>
            <p>{m.note}</p>
            {m.pctile != null && (
              <>
                <div className="rk-meter" title={ordinalPct(m.pctile)}>
                  <span style={{ width: `${m.pctile}%` }} />
                </div>
                <small>{ordinalPct(m.pctile)}</small>
              </>
            )}
          </div>
        ))}
      </div>
      <dl className="rk-context">
        <div>
          <dt>{adjusted ? "Rank with earnings as reported" : "Rank after cost of living"}</dt>
          <dd>#{other.rank}<span> (range {other.low}–{other.high})</span></dd>
        </div>
        <div>
          <dt>Where graduates work</dt>
          <dd>
            {s.rpp_grad != null ? `Price level ${s.rpp_grad.toFixed(0)}` : "—"}
            <span> (U.S. = 100) · {s.location_observed ? "observed (Census)" : "modeled estimate"}</span>
          </dd>
        </div>
        <div>
          <dt>Average net price</dt>
          <dd>{money(s.net_price)}<span> / yr · not scored</span></dd>
        </div>
        <div>
          <dt>Completions in programs with published earnings</dt>
          <dd>{Math.round(s.program_coverage * 100)}%<span> · not the share of graduates observed</span></dd>
        </div>
      </dl>
      <TopMajors unitid={s.unitid} onOpenMajor={onOpenMajor} />
    </div>
  );
}

function TopMajors({ unitid, onOpenMajor }: { unitid: number; onOpenMajor: (cip: string) => void }) {
  const { data } = useJson<SchoolMajorsFile>("/data/rankings/majors/bachelors_by_school.json");
  const best = useMemo(() => {
    const rows = data?.ranks[String(unitid)] ?? [];
    // Only majors in the top half of their table count as "strongest".
    return rows.filter(([, rank, n]) => rank / n <= 0.5).sort((a, b) => a[1] / a[2] - b[1] / b[2]).slice(0, 5);
  }, [data, unitid]);
  if (!data || best.length === 0) return null;
  return (
    <div className="rk-topmajors">
      <h4>Strongest bachelor’s majors here</h4>
      <ul>
        {best.map(([cip, rank, n]) => (
          <li key={cip}>
            <button type="button" className="rk-link-btn" onClick={() => onOpenMajor(cip)}>
              {data.majors[cip]}
            </button>
            <span>#{rank} of {n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
