import type { CareerAi } from "@/lib/career-ai";
import type { CareerSchool } from "@/lib/career-ranking";

type Props = {
  ai: CareerAi;
  schools: CareerSchool[];
  /** The formula's My path rank at default settings, by school id. */
  formula: Map<number, string>;
  admitted: Set<number>;
};

const key = (name: string) => name.trim().toLowerCase();

/** The student's own judged ranking, in their order, next to the formula's rank for the same school. */
export default function AiList({ ai, schools, formula, admitted }: Props) {
  const byName = new Map(schools.map((s) => [key(s.name), s]));
  return (
    <div className="rk-list rk-list--ai" role="list" aria-label="Your judged ranking">
      <div className="rk-row rk-row--head" aria-hidden="true">
        <span>Rank</span>
        <span>College</span>
        <span title="Your My path rank at default settings">Formula</span>
      </div>
      {ai.list.map((x, i) => {
        const s = byName.get(key(x.school));
        const isAdmitted = !!s && admitted.has(s.id);
        return (
          <div role="listitem" key={`${x.school}-${i}`} className={"rk-item" + (isAdmitted ? " is-admitted" : "")}>
            <div className="rk-row">
              <span className="rk-rank"><span className="rk-rank__n">{x.rank}</span></span>
              <span className="rk-school">
                <span className="rk-school__name">
                  {s?.name ?? x.school}
                  {isAdmitted && <span className="rk-badge">Admitted</span>}
                </span>
                {s && <span className="rk-school__meta">{s.city}, {s.state}</span>}
                {x.why && <span className="rk-ai__why">{x.why}</span>}
              </span>
              <span className="rk-cell rk-num" data-label="Formula">{s ? formula.get(s.id) ?? "—" : "—"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
