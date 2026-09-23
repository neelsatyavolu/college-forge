import { useId } from "react";
import type { Filters } from "./types";

type FilterBarProps = {
  filters: Filters;
  states: string[];
  onChange: (patch: Partial<Filters>) => void;
  searchLabel?: string;
  showControl?: boolean;
};

export function FilterBar({ filters, states, onChange, searchLabel = "Search colleges", showControl = true }: FilterBarProps) {
  const id = useId();
  const controls: { value: Filters["control"]; label: string }[] = [
    { value: "", label: "All" },
    { value: "public", label: "Public" },
    { value: "private", label: "Private" },
  ];
  return (
    <div className="rk-filters">
      <label className="rk-field rk-field--grow" htmlFor={`${id}-q`}>
        <span>{searchLabel}</span>
        <input
          id={`${id}-q`}
          className="rk-input"
          type="search"
          placeholder="College name, city or state"
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
        />
      </label>
      <label className="rk-field" htmlFor={`${id}-state`}>
        <span>State</span>
        <select id={`${id}-state`} className="rk-input" value={filters.state} onChange={(e) => onChange({ state: e.target.value })}>
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      {showControl && (
        <div className="rk-field" role="group" aria-label="Public or private">
          <span aria-hidden="true">Type</span>
          <div className="rk-pills">
            {controls.map((c) => (
              <button
                key={c.label}
                type="button"
                className="rk-pill"
                aria-pressed={filters.control === c.value}
                onClick={() => onChange({ control: c.value })}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RankCell({ rank, low, high }: { rank: number; low?: number; high?: number }) {
  const showRange = low != null && high != null && (low !== rank || high !== rank);
  return (
    <span className="rk-rank">
      <span className="rk-rank__n">{rank}</span>
      {showRange && (
        <span className="rk-rank__range" title="90% of the time, this college ranks within this range when the earnings data are redrawn from their uncertainty">
          {low}–{high}
        </span>
      )}
    </span>
  );
}

export function ScoreBar({ value, label }: { value: number; label?: string }) {
  const w = Math.max(3, Math.min(100, value));
  return (
    <span className="rk-scorebar" aria-label={label}>
      <span className="rk-scorebar__track"><span className="rk-scorebar__fill" style={{ width: `${w}%` }} /></span>
      <span className="rk-scorebar__n">{value.toFixed(1)}</span>
    </span>
  );
}

type SchoolNameProps = { name: string; city: string | null; state: string; control: string; notes?: string[] };

export function SchoolName({ name, city, state, control, notes = [] }: SchoolNameProps) {
  return (
    <span className="rk-school">
      <span className="rk-school__name">{name}</span>
      <span className="rk-school__meta">
        {[city, state].filter(Boolean).join(", ")} · {control === "public" ? "Public" : "Private"}
      </span>
      {notes.length > 0 && <span className="rk-school__notes">{notes.join(" · ")}</span>}
    </span>
  );
}

export function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="rk-empty">
      <p>No colleges match these filters.</p>
      <button type="button" className="rk-link-btn" onClick={onClear}>Clear filters</button>
    </div>
  );
}
