import { useMemo, useState } from "react";
import { money, ordinalPct, rate, signedPct } from "./format";
import { useJson } from "./hooks";
import { RankCell, SchoolName, ScoreBar } from "./parts";
import type { School, SchoolMajorsFile } from "./types";

type Props = {
  schools: School[];
  onOpenMajor: (cip: string) => void;
};

export default function OverallView({ schools, onOpenMajor }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="rk-list" role="list" aria-label="Overall career ranking">
      <div className="rk-row rk-row--head" aria-hidden="true">
        <span>Rank</span>
        <span>College</span>
        <span>Career score</span>
        <span title="Early-career earnings compared with graduates of the same majors nationally, after cost of living">vs. same majors</span>
        <span>Typical salary</span>
        <span>Graduates</span>
        <span />
      </div>
      {schools.map((s) => (
        <OverallRow
          key={s.unitid}
          school={s}
          expanded={open === s.unitid}
          onToggle={() => setOpen((v) => (v === s.unitid ? null : s.unitid))}
          onOpenMajor={onOpenMajor}
        />
      ))}
    </div>
  );
}

type RowProps = { school: School; expanded: boolean; onToggle: () => void; onOpenMajor: (cip: string) => void };

function OverallRow({ school: s, expanded, onToggle, onOpenMajor }: RowProps) {
  const detailId = `school-${s.unitid}`;
  return (
    <div role="listitem" className={"rk-item" + (expanded ? " is-open" : "")}>
      <button type="button" className="rk-row" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle}>
        <RankCell rank={s.rank} low={s.rank_low} high={s.rank_high} />
        <SchoolName name={s.institution} city={s.city} state={s.state} control={s.control} />
        <ScoreBar value={s.score} label={`Career score ${s.score.toFixed(1)} out of 100`} />
        <span className="rk-cell rk-num" data-label="vs. same majors">
          <strong className={s.early_premium_pct >= 0 ? "rk-pos" : "rk-neg"}>{signedPct(s.early_premium_pct)}</strong>
        </span>
        <span className="rk-cell rk-num" data-label="Typical salary">{money(s.typical_salary)}</span>
        <span className="rk-cell rk-num" data-label="Graduates">{rate(s.graduation_rate)}</span>
        <span className="rk-chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && <SchoolDetail id={detailId} school={s} onOpenMajor={onOpenMajor} />}
    </div>
  );
}

function SchoolDetail({ id, school: s, onOpenMajor }: { id: string; school: School; onOpenMajor: (cip: string) => void }) {
  const metrics = [
    {
      label: "Early-career earnings",
      weight: "40%",
      value: signedPct(s.early_premium_pct),
      note: "vs. graduates of the same majors nationally, after cost of living",
      pctile: s.early_premium_pctile,
    },
    {
      label: "Long-run earnings",
      weight: "20%",
      value: signedPct(s.long_premium_pct),
      note: `vs. what its majors predict · ${money(s.salary_10yr)} median 10 years after starting`,
      pctile: s.long_premium_pctile,
    },
    { label: "Graduation", weight: "25%", value: rate(s.graduation_rate), note: "finish within six years", pctile: s.graduation_pctile },
    { label: "Employment", weight: "15%", value: rate(s.employment_rate), note: "of graduates working three years out", pctile: s.employment_pctile },
  ];
  return (
    <div id={id} className="rk-detail">
      <div className="rk-metrics">
        {metrics.map((m) => (
          <div className="rk-metric" key={m.label}>
            <div className="rk-metric__top">
              <span>{m.label}</span>
              <span className="rk-metric__weight">{m.weight} of score</span>
            </div>
            <div className="rk-metric__value">{m.value}</div>
            <p>{m.note}</p>
            {m.pctile != null && (
              <div className="rk-meter" title={ordinalPct(m.pctile)}>
                <span style={{ width: `${m.pctile}%` }} />
              </div>
            )}
            <small>{ordinalPct(m.pctile)}</small>
          </div>
        ))}
      </div>
      <dl className="rk-context">
        <div>
          <dt>Rank range</dt>
          <dd>#{s.rank_low}–#{s.rank_high}</dd>
        </div>
        <div>
          <dt>Cost of living where grads work</dt>
          <dd>{s.rpp_grad != null ? `${s.rpp_grad.toFixed(0)} (U.S. = 100)` : "—"}</dd>
        </div>
        <div>
          <dt>Average net price</dt>
          <dd>{money(s.net_price)}<span> / yr · not scored</span></dd>
        </div>
        <div>
          <dt>Graduates with earnings data</dt>
          <dd>{Math.round(s.coverage * 100)}%</dd>
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
    return [...rows].sort((a, b) => a[1] / a[2] - b[1] / b[2]).slice(0, 5);
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
