import { useEffect, useMemo, useRef, useState } from "react";
import { credentialLabel, horizonLabel, matchesFilters, money, signedPct } from "./format";
import { useJson } from "./hooks";
import { EmptyState, FilterBar, RankCell, SchoolName } from "./parts";
import type { Credential, Filters, MajorFile, MajorSummary } from "./types";

type Props = {
  index: MajorSummary[];
  credential: Credential;
  major: string;
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

export default function MajorsView({ index, credential, major, filters, onChange }: Props) {
  const [find, setFind] = useState("");
  const pool = useMemo(() => index.filter((m) => m.credential === credential), [index, credential]);
  const selected = pool.find((m) => m.cip === major) ?? pool[0];
  const visible = useMemo(() => {
    const q = find.trim().toLowerCase();
    return q ? pool.filter((m) => `${m.name} ${m.family}`.toLowerCase().includes(q)) : pool;
  }, [pool, find]);
  const groups = useMemo(() => groupByFamily(visible), [visible]);
  const allGroups = useMemo(() => groupByFamily(pool), [pool]);

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
        {selected && <MajorHeader major={selected} credential={credential} />}
        <FilterBar filters={filters} states={statesOf(file.data)} onChange={onChange} />
        {file.error && <div className="cf-notice" role="alert">{file.error}</div>}
        {file.loading && !file.data && <div className="rk-loading">Loading {selected?.name}…</div>}
        {file.data && file.data.cip === selected?.cip && <MajorRows file={file.data} filters={filters} onClear={() => onChange({ q: "", state: "", control: "" })} />}
      </section>
    </div>
  );
}

function statesOf(file: MajorFile | null): string[] {
  return file ? [...new Set(file.rows.map((r) => r.state))].sort() : [];
}

function MajorHeader({ major, credential }: { major: MajorSummary; credential: Credential }) {
  const thin = major.n_ranked < 60;
  return (
    <header className="rk-majorhead">
      <span className="cf-eyebrow">{major.family.toUpperCase()} · {credentialLabel(credential).toUpperCase()}</span>
      <h2>{major.name}</h2>
      <p>
        {major.n_ranked.toLocaleString()} colleges ranked{major.n_ranked > 250 ? " · top 250 shown" : ""}
        {major.national_median != null && <> · national median salary {money(major.national_median)} four years after graduating</>}
      </p>
      {thin && (
        <p className="rk-note">
          Few programs in this major publish earnings, usually because most students don’t receive federal aid.
          Missing colleges aren’t ranked low. They just have no public data.
        </p>
      )}
    </header>
  );
}

function MajorRows({ file, filters, onClear }: { file: MajorFile; filters: Filters; onClear: () => void }) {
  const rows = file.rows.filter((r) => matchesFilters(r, filters));
  if (rows.length === 0) return <EmptyState onClear={onClear} />;
  return (
    <div className="rk-list rk-list--major" role="list" aria-label={`${file.name} ranking`}>
      <div className="rk-row rk-row--head" aria-hidden="true">
        <span>Rank</span>
        <span>College</span>
        <span title="Median earnings compared with graduates of this major nationally, after cost of living">vs. national</span>
        <span>Median salary</span>
        <span title="Median salary divided by the price level where graduates work">After cost of living</span>
        <span>Overall</span>
      </div>
      {rows.map((r) => (
        <div role="listitem" className="rk-row" key={r.unitid}>
          <RankCell rank={r.rank} low={r.rank_low} high={r.rank_high} />
          <SchoolName name={r.institution} city={r.city} state={r.state} control={r.control} />
          <span className="rk-cell rk-num" data-label="vs. national">
            <strong className={r.premium_pct >= 0 ? "rk-pos" : "rk-neg"}>{signedPct(r.premium_pct)}</strong>
          </span>
          <span className="rk-cell rk-num" data-label="Median salary">
            {money(r.salary)}
            {r.salary_horizon && r.salary_horizon !== "4yr" && <small className="rk-horizon">{horizonLabel(r.salary_horizon)}</small>}
          </span>
          <span className="rk-cell rk-num" data-label="After cost of living">{money(r.salary_adjusted)}</span>
          <span className="rk-cell rk-num rk-muted" data-label="Overall rank">{r.overall_rank != null ? `#${r.overall_rank}` : "—"}</span>
        </div>
      ))}
    </div>
  );
}
