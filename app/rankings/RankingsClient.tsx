"use client";

import { useCallback, useMemo } from "react";
import BeatsView from "./BeatsView";
import { formatDate, matchesFilters, rankFor } from "./format";
import { useJson, useRankingsQuery, useTheme, type RankingsQuery } from "./hooks";
import MajorsView from "./MajorsView";
import Methodology from "./Methodology";
import OverallView from "./OverallView";
import { EmptyState, FilterBar } from "./parts";
import type { MajorIndexFile, OverallFile, PriceMode, View } from "./types";
import WorkspaceShell from "./WorkspaceShell";
import "./rankings.css";

const TABS: { id: View; label: string }[] = [
  { id: "overall", label: "Overall" },
  { id: "majors", label: "By major" },
  { id: "beats", label: "Beats expectations" },
];

const PRICE_OPTIONS: { id: PriceMode; label: string; help: string }[] = [
  { id: "nominal", label: "None", help: "Earnings as published, with no location estimates. The version our backtest checks." },
  {
    id: "partial",
    label: "Half",
    help: "Default. Gives equal weight to what the degree earns and what that pay buys where graduates live (earnings divided by the square root of the local price level). A judgment call, not a measured optimum.",
  },
  {
    id: "adjusted",
    label: "Full",
    help: "Earnings divided by the full local price level where graduates work. Locations are estimated for most colleges and not yet validated.",
  },
];

const PRICE_NOTE: Record<PriceMode, string> = {
  nominal: "earnings as reported",
  partial: "half-adjusted for cost of living",
  adjusted: "fully adjusted for cost of living",
};

function PriceToggle({ value, onChange }: { value: PriceMode; onChange: (v: PriceMode) => void }) {
  return (
    <div className="rk-pricetoggle" role="group" aria-label="Cost-of-living adjustment">
      <span className="rk-pricetoggle__label">Cost of living</span>
      {PRICE_OPTIONS.map((o) => (
        <button key={o.id} type="button" className="rk-pill" title={o.help} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function RankingsClient() {
  const [theme, toggleTheme] = useTheme();
  const [query, setQuery] = useRankingsQuery();
  const overall = useJson<OverallFile>("/data/rankings/overall.json");
  const beats = useJson<OverallFile>(query.view === "beats" ? "/data/rankings/value_added.json" : null);
  const index = useJson<MajorIndexFile>("/data/rankings/majors/index.json");

  const update = useCallback((patch: Partial<RankingsQuery>) => setQuery(patch), [setQuery]);
  const clearFilters = () => update({ q: "", state: "", control: "" });
  const openMajor = (cip: string) => {
    update({ view: "majors", credential: "bachelors", major: cip, q: "", state: "", control: "" });
    document.getElementById("rankings-top")?.scrollIntoView({ behavior: "smooth" });
  };

  const isBeats = query.view === "beats";
  const list = useMemo(() => {
    if (isBeats) return beats.data?.schools;
    const schools = overall.data?.schools;
    if (!schools) return undefined;
    // overall.json holds the top 250 under either ordering; show the top 250 of the active one.
    return schools
      .filter((s) => rankFor(s, query.prices).rank <= 250)
      .sort((a, b) => rankFor(a, query.prices).rank - rankFor(b, query.prices).rank);
  }, [isBeats, beats.data, overall.data, query.prices]);
  const states = useMemo(() => [...new Set((list ?? []).map((s) => s.state))].sort(), [list]);
  const shown = useMemo(() => (list ?? []).filter((s) => matchesFilters(s, query)), [list, query]);

  const meta = overall.data;
  const error = overall.error || index.error || beats.error;

  return (
    <WorkspaceShell theme={theme} onToggleTheme={toggleTheme} topline={meta ? `Ranking rebuilt ${formatDate(meta.generated)}` : "Outcomes, not prestige"}>
      <div className="cf-page rk-page" id="rankings-top">
        <header className="rk-header">
          <h1 className="cf-page-title">Where graduates did best</h1>
          <p className="rk-lede">
            Earnings compared with the same major elsewhere, plus graduation and employment, from federal records.
            No weight on prestige or selectivity. <a href="#methodology">How it works</a>
          </p>
        </header>

        <div className="rk-toolbar">
          <div className="rk-tabs" role="tablist" aria-label="Ranking view">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={query.view === t.id} className="rk-tab" onClick={() => update({ view: t.id })}>
                {t.label}
              </button>
            ))}
          </div>
          {!isBeats && <PriceToggle value={query.prices} onChange={(prices) => update({ prices })} />}
        </div>

        {error && <div className="cf-notice" role="alert">{error}</div>}

        {query.view === "majors" ? (
          index.data &&
          meta && (
            <MajorsView
              index={index.data.majors}
              cohorts={meta.cohorts}
              credential={query.credential}
              major={query.major}
              prices={query.prices}
              filters={query}
              onChange={update}
            />
          )
        ) : (
          <>
            <FilterBar filters={query} states={states} onChange={update} />
            <p className="rk-resultline">
              {!list
                ? "Loading rankings…"
                : isBeats
                  ? <>Colleges furthest above what their incoming students predict (not proof the college caused it){beats.data?.fit ? `; a typical college lands within ±${Math.round(beats.data.fit.residual_sd_points)} points of prediction` : ""}. Showing <strong>{shown.length}</strong> of {list.length}.</>
                  : <>
                      {shown.length === list.length ? <>Top <strong>{list.length}</strong></> : <>Showing <strong>{shown.length}</strong> of the top {list.length}</>} of{" "}
                      {meta?.n_ranked.toLocaleString()} colleges, {PRICE_NOTE[query.prices]}. Small
                      numbers under a rank show its likely range.
                    </>}
            </p>
            {list && shown.length === 0 && <EmptyState onClear={clearFilters} />}
            {list && shown.length > 0 && (isBeats ? <BeatsView schools={shown} /> : <OverallView schools={shown} prices={query.prices} onOpenMajor={openMajor} />)}
          </>
        )}

        {meta && <Methodology weights={meta.weights} cohorts={meta.cohorts} />}
      </div>
    </WorkspaceShell>
  );
}
