import { rate, signedPoints } from "./format";
import { RankCell, SchoolName } from "./parts";
import type { School } from "./types";

export default function BeatsView({ schools }: { schools: School[] }) {
  return (
    <div className="rk-list rk-list--beats" role="list" aria-label="Colleges that beat expectations">
      <div className="rk-row rk-row--head" aria-hidden="true">
        <span>Rank</span>
        <span>College</span>
        <span title="Score minus the score predicted (out of sample) from incoming students’ test scores, admit rate, and Pell and first-generation shares">Above prediction</span>
        <span>Score</span>
        <span>Pell-eligible</span>
        <span>Overall</span>
      </div>
      {schools.map((s) => (
        <div role="listitem" className="rk-row" key={s.unitid}>
          <RankCell rank={s.beats_rank ?? 0} />
          <SchoolName name={s.institution} city={s.city} state={s.state} control={s.control} />
          <span className="rk-cell rk-num" data-label="Above prediction">
            <strong className="rk-pos">{signedPoints(s.beats_expectations)}</strong>
            <small className="rk-horizon">points</small>
          </span>
          <span className="rk-cell rk-num" data-label="Score">{s.score.toFixed(1)}</span>
          <span className="rk-cell rk-num" data-label="Pell-eligible">{rate(s.pct_pell)}</span>
          <span className="rk-cell rk-num rk-muted" data-label="Overall rank">#{s.rank}</span>
        </div>
      ))}
    </div>
  );
}
