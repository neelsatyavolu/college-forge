import { useMemo, useState } from "react";
import { byMode, money, ordinalPct, otherViewNote, rankFor, rate, signedPct } from "./format";
import { useJson } from "./hooks";
import { RankCell, SchoolName, ScoreBar } from "./parts";
import type { PriceMode, School, SchoolMajorsFile } from "./types";

type Props = {
  schools: School[];
  prices: PriceMode;
  onOpenMajor: (cip: string) => void;
};

/** Colleges whose scored programs mostly use 5-year earnings (an older graduating class). */
const MOSTLY_OLDER_DATA = 0.5;

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
  const score = byMode(prices, s.score, s.score_partial, s.score_adjusted);
  const premium = byMode(prices, s.early_premium_pct, s.early_premium_partial_pct, s.early_premium_adjusted_pct);
  const notes = [otherViewNote(s, prices), ...((s.fallback_share ?? 0) > MOSTLY_OLDER_DATA ? ["mostly older earnings data"] : [])];
  return (
    <div role="listitem" className={"rk-item" + (expanded ? " is-open" : "")}>
      <button type="button" className="rk-row" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle}>
        <RankCell rank={r.rank} low={r.low} high={r.high} />
        <SchoolName name={s.institution} city={s.city} state={s.state} control={s.control} notes={notes} />
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
  const costNote = byMode(prices, "as reported", "half-adjusted for cost of living", "fully adjusted for cost of living");
  const metrics = [
    {
      label: "Early-career earnings",
      weight: "50% of score",
      value: signedPct(byMode(prices, s.early_premium_pct, s.early_premium_partial_pct, s.early_premium_adjusted_pct)),
      note: `vs. graduates of the same majors nationally, ${costNote}; about four years after graduating`,
      pctile: byMode(prices, s.early_premium_pctile, s.early_premium_partial_pctile, s.early_premium_adjusted_pctile),
    },
    { label: "Graduation", weight: "31% of score", value: rate(s.graduation_rate), note: "of first-time, full-time students finish within six years", pctile: s.graduation_pctile },
    { label: "Employment", weight: "19% of score", value: rate(s.employment_rate), note: "of graduates working three years out, among those not back in school", pctile: s.employment_pctile },
    {
      label: "Later earnings",
      weight: "not scored",
      value: money(s.earnings_10yr),
      note: `median about 6 years after graduating (10 after starting), including students who didn’t finish; ${signedPct(byMode(prices, s.later_premium_pct, s.later_premium_partial_pct, s.later_premium_adjusted_pct))} vs. what its majors predict`,
      pctile: null,
    },
  ];
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
          <dt>Rank in the other cost-of-living views</dt>
          <dd>{otherViewNote(s, prices)}</dd>
        </div>
        <div>
          <dt>Where graduates work</dt>
          <dd>
            {s.rpp_grad != null ? `Price level ${s.rpp_grad.toFixed(0)}` : "—"}
            <span> (U.S. = 100) · {s.location_observed ? "observed (Census)" : "modeled estimate"}</span>
          </dd>
        </div>
        <div>
          <dt>Graduation of Pell Grant students</dt>
          <dd>
            {rate(s.pell_graduation_rate)}
            <span> · {pellNote(s)} · not scored</span>
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
        {s.fallback_share != null && s.fallback_share > 0 && (
          <div>
            <dt>Programs scored on older data</dt>
            <dd>{Math.round(s.fallback_share * 100)}%<span> · 5-year earnings of an earlier class, adjusted to the 4-year scale</span></dd>
          </div>
        )}
      </dl>
      <TopMajors unitid={s.unitid} onOpenMajor={onOpenMajor} />
    </div>
  );
}

/** Gap to all students in the same cohort, and the cohort size so small groups read as noisy. */
function pellNote(s: School): string {
  if (s.pell_graduation_rate == null) return "not reported";
  const gap = Math.round((s.pell_graduation_rate - s.graduation_rate) * 100);
  const vs = gap === 0 ? "same as all students" : `${Math.abs(gap)} pts ${gap > 0 ? "above" : "below"} all students`;
  return s.pell_cohort != null ? `${vs}; cohort of ${Math.round(s.pell_cohort).toLocaleString("en-US")}` : vs;
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
