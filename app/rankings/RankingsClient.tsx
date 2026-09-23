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

const TABS: { id: View; label: string; blurb: string }[] = [
  { id: "overall", label: "Overall", blurb: "Colleges whose past graduates did best across earnings, graduation and employment. If you know your major, the By major tab is more relevant." },
  { id: "majors", label: "By major", blurb: "Colleges whose graduates in one major out-earned graduates of the same major elsewhere." },
  { id: "beats", label: "Beats expectations", blurb: "Colleges whose outcomes beat what a model predicts from their incoming students. Useful for spotting overlooked colleges; not proof that a college caused the difference." },
];

const PRICE_OPTIONS: { id: PriceMode; label: string }[] = [
  { id: "adjusted", label: "After cost of living" },
  { id: "nominal", label: "As reported" },
];

function PriceToggle({ value, onChange }: { value: PriceMode; onChange: (v: PriceMode) => void }) {
  return (
    <div className="rk-pricetoggle" role="group" aria-label="Cost of living">
      <span>Earnings</span>
      <div className="rk-pills">
        {PRICE_OPTIONS.map((o) => (
          <button key={o.id} type="button" className="rk-pill" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
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

  const counts = useMemo(() => {
    const majors = index.data?.majors ?? [];
    return {
      bachelors: majors.filter((m) => m.credential === "bachelors").length,
      masters: majors.filter((m) => m.credential === "masters").length,
    };
  }, [index.data]);

  const meta = overall.data;
  const error = overall.error || index.error || beats.error;
  const tab = TABS.find((t) => t.id === query.view) ?? TABS[0];

  return (
    <WorkspaceShell theme={theme} onToggleTheme={toggleTheme} topline={meta ? `Ranking rebuilt ${formatDate(meta.generated)}` : "Outcomes, not prestige"}>
      <div className="cf-page rk-page" id="rankings-top">
        <header className="rk-header">
          <div className="cf-eyebrow">CAREER OUTCOMES · BACKTESTED{meta ? ` · METHOD v${meta.methodology_version}` : ""}</div>
          <h1 className="cf-page-title">Where graduates did best</h1>
          <p className="cf-page-lede rk-lede">
            How past graduates fared: earnings compared with people who studied the same major elsewhere and adjusted for
            living costs where graduates work, plus graduation and employment, from federal records of students who
            received financial aid. Selectivity and prestige get no direct weight. We checked the earnings estimates against a later graduating class they never saw. Use it to
            discover and compare colleges, not to decide on rank alone.
          </p>
        </header>

        <div className="rk-facts" role="group" aria-label="At a glance">
          <div><span className="cf-progress-value">{meta ? meta.n_ranked.toLocaleString() : "—"}</span><span>colleges scored</span></div>
          <div><span className="cf-progress-value">{counts.bachelors || "—"}</span><span>bachelor’s majors</span></div>
          <div><span className="cf-progress-value">{counts.masters || "—"}</span><span>master’s majors</span></div>
          <div><span className="cf-progress-value">0%</span><span>direct weight on selectivity</span></div>
        </div>

        <div className="rk-tabs" role="tablist" aria-label="Ranking view">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={query.view === t.id} className="rk-tab" onClick={() => update({ view: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="rk-tabbar">
          <p className="rk-tabblurb">{tab.blurb}</p>
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
                  ? <>Showing <strong>{shown.length}</strong> of the {list.length} colleges furthest above prediction. Points are on the 0–100 score scale.{beats.data?.fit ? ` The student-profile model explains about ${Math.round(beats.data.fit.out_of_fold_r2 * 100)}% of score differences, and a typical college lands within about ±${Math.round(beats.data.fit.residual_sd_points)} points of its prediction, so small gaps mean little.` : ""}</>
                  : <>Showing <strong>{shown.length}</strong> of the top {list.length}. Small numbers under each rank are its likely range within this model; overlapping ranges mean the exact order is uncertain.</>}
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
