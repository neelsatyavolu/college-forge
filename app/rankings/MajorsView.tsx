import { useEffect, useMemo, useRef, useState } from "react";
import { credentialLabel, horizonLabel, matchesFilters, money, otherViewNote, rankFor, signedPct } from "./format";
import { useJson } from "./hooks";
import { FilterBar, RankCell, SchoolName } from "./parts";
import type { Cohorts, Credential, Filters, MajorFile, MajorRow, MajorSummary, PriceMode } from "./types";

const TOP_N = 250;
const shortHorizon = (h: string) =>
  h === "5yr" ? "5 yrs out · older class" : h ? `${h.replace("yr", "")} yr${h === "1yr" ? "" : "s"} out` : "";

type Props = {
  index: MajorSummary[];
  cohorts: Cohorts;
  credential: Credential;
  major: string;
  prices: PriceMode;
  filters: Filters;
  onChange: (patch: { credential?: Credential; major?: string } & Partial<Filters>) => void;
};

function groupByFamily(majors: MajorSummary[]): [string, MajorSummary[]][] {
  const groups = new Map<string, MajorSummary[]>();
  for (const m of majors) groups.set(m.family, [...(groups.get(m.family) ?? []), m]);
  return [...groups.entries()]
    .map(([family, list]): [string, MajorSummary[]] => [family, [...list].sort((a, b) => a.name.localeCompare(b.name))])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

export default function MajorsView({ index, cohorts, credential, major, prices, filters, onChange }: Props) {
  const [find, setFind] = useState("");
  const pool = useMemo(() => index.filter((m) => m.credential === credential), [index, credential]);
  const selected = pool.find((m) => m.cip === major) ?? pool[0];
  const visible = useMemo(() => {
    const q = find.trim().toLowerCase();
    return q ? pool.filter((m) => `${m.name} ${m.family}`.toLowerCase().includes(q)) : pool;
  }, [pool, find]);
  const groups = useMemo(() => groupByFamily(visible), [visible]);
  const allGroups = useMemo(() => groupByFamily(pool), [pool]);
  const related = useMemo(
    () => (selected ? pool.filter((m) => m.family === selected.family && m.cip !== selected.cip).slice(0, 6) : []),
    [pool, selected]
  );

  const file = useJson<MajorFile>(selected ? `/data/rankings/majors/${credential}-${selected.cip}.json` : null);
  const listRef = useRef<HTMLDivElement>(null);
  // Keep the chosen major visible in the picker (e.g. after arriving from a link).
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (list && item) list.scrollTop = item.offsetTop - list.clientHeight / 3;
  }, [selected?.cip]);

  return (
    <div className="rk-majors">
      <aside className="rk-picker" aria-label="Choose a major">
        <div className="rk-pills" role="group" aria-label="Degree level">
          {(["bachelors", "masters"] as Credential[]).map((c) => (
            <button key={c} type="button" className="rk-pill" aria-pressed={credential === c} onClick={() => onChange({ credential: c, major: "" })}>
              {credentialLabel(c)}
            </button>
          ))}
        </div>
        <label className="rk-field rk-picker__mobile">
          <span>Major</span>
          <select className="rk-input" value={selected?.cip ?? ""} onChange={(e) => onChange({ major: e.target.value })}>
            {allGroups.map(([family, list]) => (
              <optgroup key={family} label={family}>
                {list.map((m) => <option key={m.cip} value={m.cip}>{m.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="rk-picker__desktop">
          <label className="rk-field">
            <span>Find a major</span>
            <input className="rk-input" type="search" placeholder={`${pool.length} ${credentialLabel(credential).toLowerCase()} majors`} value={find} onChange={(e) => setFind(e.target.value)} />
          </label>
          <div className="rk-picker__list" ref={listRef}>
            {groups.map(([family, list]) => (
              <div key={family} className="rk-picker__group">
                <div className="rk-picker__family">{family}</div>
                {list.map((m) => (
                  <button key={m.cip} type="button" className="rk-picker__item" aria-current={m.cip === selected?.cip ? "true" : undefined} onClick={() => onChange({ major: m.cip })}>
                    <span>{m.name}</span>
                    <small>{m.n_ranked}</small>
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && <p className="rk-muted">No majors match “{find}”.</p>}
          </div>
        </div>
      </aside>

      <section className="rk-majortable" aria-live="polite">
        {selected && <MajorHeader major={selected} credential={credential} cohorts={cohorts} related={related} onPick={(cip) => onChange({ major: cip })} />}
        <FilterBar filters={filters} states={statesOf(file.data)} onChange={onChange} />
        {file.error && <div className="cf-notice" role="alert">{file.error}</div>}
        {file.loading && !file.data && <div className="rk-loading">Loading {selected?.name}…</div>}
        {file.data && file.data.cip === selected?.cip && (
          <MajorRows file={file.data} prices={prices} filters={filters} onClear={() => onChange({ q: "", state: "", control: "" })} />
        )}
      </section>
    </div>
  );
}

function statesOf(file: MajorFile | null): string[] {
  return file ? [...new Set(file.rows.map((r) => r.state))].sort() : [];
}

type HeaderProps = { major: MajorSummary; credential: Credential; cohorts: Cohorts; related: MajorSummary[]; onPick: (cip: string) => void };

function MajorHeader({ major, credential, cohorts, related, onPick }: HeaderProps) {
  const facts = [
    `${major.n_ranked.toLocaleString()} colleges ranked`,
    major.national_median != null ? `national median ${money(major.national_median)} (4 yrs out)` : null,
    major.fallback_share > 0 ? `${Math.round(major.fallback_share * 100)}% on older data` : null,
    credential === "masters" ? "experimental" : null,
  ].filter(Boolean);
  return (
    <header className="rk-majorhead">
      <h2>{major.name}</h2>
      <p>{facts.join(" · ")}</p>
      <details className="rk-majorhead__more">
        <summary>How this table is ranked</summary>
        <p>
          Ranked by a modeled earnings premium versus graduates of this major nationally, using earnings four years after
          graduating. Programs with few graduates are pulled toward their college’s results in other majors, which predicted
          the next graduating class best in our backtest, so the order isn’t the same as sorting by the earnings column.
          4-year figures are {cohorts["4yr"]}, in 2024 dollars. Degree earnings aren’t job outcomes: a graduate working in
          another field still counts here.
        </p>
        {major.fallback_share > 0 && (
          <p>
            <strong>Older data.</strong> {Math.round(major.fallback_share * 100)}% of ranked programs here withhold four-year
            earnings, so they’re scored on five-year earnings of an older class ({cohorts["5yr"]}), shifted onto the four-year
            scale. Those rows say “older class”; treat their positions as less certain.
          </p>
        )}
        {credential === "masters" && (
          <p>
            <strong>Experimental.</strong> Master’s students often bring years of work experience, and cost of living here uses
            each college’s undergraduate destinations.
          </p>
        )}
        {major.n_ranked < 60 && (
          <p>
            Few programs in this major publish earnings, usually because most students don’t receive federal aid. Missing
            colleges aren’t ranked low; they have no public data.
          </p>
        )}
        <p>
          ● marks colleges whose graduates’ locations come from Census data; for the rest, cost of living uses a modeled
          estimate.{major.n_ranked > TOP_N ? ` Search and filters look within the top ${TOP_N} shown.` : ""}
        </p>
        {related.length > 0 && (
          <div className="rk-related">
            <span>Related majors:</span>
            {related.map((m) => (
              <button key={m.cip} type="button" className="rk-pill" onClick={() => onPick(m.cip)}>{m.name}</button>
            ))}
          </div>
        )}
      </details>
    </header>
  );
}

function MajorRows({ file, prices, filters, onClear }: { file: MajorFile; prices: PriceMode; filters: Filters; onClear: () => void }) {
  // The file holds the top 250 under either ordering; show the top 250 of the active one.
  const rows = useMemo(
    () =>
      file.rows
        .filter((r) => rankFor(r, prices).rank <= TOP_N && matchesFilters(r, filters))
        .sort((a, b) => rankFor(a, prices).rank - rankFor(b, prices).rank),
    [file, filters, prices]
  );
  if (rows.length === 0) return <MissingExplainer onClear={onClear} />;
  return (
    <>
      <div className="rk-list rk-list--major" role="list" aria-label={`${file.name} ranking`}>
        <div className="rk-row rk-row--head" aria-hidden="true">
          <span>Rank</span>
          <span>College</span>
          <span title="Modeled earnings premium versus graduates of this major nationally">vs. national</span>
          <span title={`Median annual earnings of graduates working and not enrolled (federal aid recipients), in 2024 dollars. Usually ${horizonLabel("4yr")}; n = graduates with earnings at that horizon.`}>Median earnings</span>
          <span title="Median earnings divided by the price level where graduates work">After cost of living</span>
          <span>Overall</span>
        </div>
        {rows.map((r) => <MajorRowView key={r.unitid} row={r} prices={prices} />)}
      </div>
    </>
  );
}

function MajorRowView({ row: r, prices }: { row: MajorRow; prices: PriceMode }) {
  const rank = rankFor(r, prices);
  const premium = prices === "adjusted" ? r.premium_adjusted_pct : r.premium_pct;
  return (
    <div role="listitem" className="rk-row">
      <RankCell rank={rank.rank} low={rank.low} high={rank.high} />
      <SchoolName name={r.institution} city={r.city} state={r.state} control={r.control} notes={[otherViewNote(r, prices)]} />
      <span className="rk-cell rk-num" data-label="vs. national">
        <strong className={premium >= 0 ? "rk-pos" : "rk-neg"}>{signedPct(premium)}</strong>
      </span>
      <span className="rk-cell rk-num" data-label="Median earnings">
        {money(r.earnings)}
        <small className="rk-horizon">
          {shortHorizon(r.earnings_horizon)}{r.earnings_count != null ? ` · n=${r.earnings_count.toLocaleString()}` : ""}
        </small>
      </span>
      <span className="rk-cell rk-num" data-label="After cost of living">
        {money(r.earnings_adjusted)}
        {r.location_observed && <small className="rk-horizon" title="Where graduates work is observed in Census data">● observed</small>}
      </span>
      <span className="rk-cell rk-num rk-muted" data-label="Overall rank">{r.overall_rank != null ? `#${r.overall_rank}` : "—"}</span>
    </div>
  );
}

function MissingExplainer({ onClear }: { onClear: () => void }) {
  return (
    <div className="rk-empty">
      <p>No colleges in this table match. A college can be missing because it:</p>
      <ul className="rk-reasons">
        <li>doesn’t offer this major, or reports it under a related major code</li>
        <li>has earnings suppressed for privacy (too few aid recipients)</li>
        <li>ranks below the top {TOP_N} shown</li>
      </ul>
      <button type="button" className="rk-link-btn" onClick={onClear}>Clear filters</button>
    </div>
  );
}
