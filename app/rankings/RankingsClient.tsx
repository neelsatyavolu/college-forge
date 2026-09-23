"use client";

import { useCallback, useMemo } from "react";
import BeatsView from "./BeatsView";
import { formatDate, matchesFilters } from "./format";
import { useJson, useRankingsQuery, useTheme, type RankingsQuery } from "./hooks";
import MajorsView from "./MajorsView";
import Methodology from "./Methodology";
import OverallView from "./OverallView";
import { EmptyState, FilterBar } from "./parts";
import type { MajorIndexFile, OverallFile, View } from "./types";
import WorkspaceShell from "./WorkspaceShell";
import "./rankings.css";

const TABS: { id: View; label: string; blurb: string }[] = [
  { id: "overall", label: "Overall", blurb: "Colleges where graduates do best across earnings, graduation and employment." },
  { id: "majors", label: "By major", blurb: "Colleges where graduates of one major out-earn graduates of the same major elsewhere." },
  { id: "beats", label: "Beats expectations", blurb: "Colleges whose graduates do better than their incoming students would predict." },
];

export default function RankingsClient() {
  const [theme, toggleTheme] = useTheme();
  const [query, setQuery] = useRankingsQuery();
  const overall = useJson<OverallFile>("/data/rankings/top250.json");
  const beats = useJson<OverallFile>(query.view === "beats" ? "/data/rankings/value_added.json" : null);
  const index = useJson<MajorIndexFile>("/data/rankings/majors/index.json");

  const update = useCallback((patch: Partial<RankingsQuery>) => setQuery(patch), [setQuery]);
  const clearFilters = () => update({ q: "", state: "", control: "" });
  const openMajor = (cip: string) => {
    update({ view: "majors", credential: "bachelors", major: cip, q: "", state: "", control: "" });
    document.getElementById("rankings-top")?.scrollIntoView({ behavior: "smooth" });
  };

  const list = query.view === "beats" ? beats.data?.schools : overall.data?.schools;
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
    <WorkspaceShell theme={theme} onToggleTheme={toggleTheme} topline={meta ? `Data updated ${formatDate(meta.generated)}` : "Outcomes, not prestige"}>
      <div className="cf-page rk-page" id="rankings-top">
        <header className="rk-header">
          <div className="cf-eyebrow">CAREER OUTCOMES RANKING{meta ? ` · METHOD v${meta.methodology_version}` : ""}</div>
          <h1 className="cf-page-title">Where graduates do best</h1>
          <p className="cf-page-lede rk-lede">
            Colleges ranked on what happens after graduation: earnings compared with people who studied the same major
            elsewhere, adjusted for cost of living, plus graduation and employment rates. How hard a college is to get into
            is not part of the score.
          </p>
        </header>

        <div className="rk-facts" role="group" aria-label="At a glance">
          <div><span className="cf-progress-value">{meta ? meta.n_ranked.toLocaleString() : "—"}</span><span>colleges scored</span></div>
          <div><span className="cf-progress-value">{counts.bachelors || "—"}</span><span>bachelor’s majors</span></div>
          <div><span className="cf-progress-value">{counts.masters || "—"}</span><span>master’s majors</span></div>
          <div><span className="cf-progress-value">0%</span><span>weight on selectivity</span></div>
        </div>

        <div className="rk-tabs" role="tablist" aria-label="Ranking view">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={query.view === t.id} className="rk-tab" onClick={() => update({ view: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="rk-tabblurb">{tab.blurb}</p>

        {error && <div className="cf-notice" role="alert">{error}</div>}

        {query.view === "majors" ? (
          index.data && (
            <MajorsView index={index.data.majors} credential={query.credential} major={query.major} filters={query} onChange={update} />
          )
        ) : (
          <>
            <FilterBar filters={query} states={states} onChange={update} />
            <p className="rk-resultline">
              {list ? (
                query.view === "beats" ? (
                  <>Showing <strong>{shown.length}</strong> of the {list.length} colleges that most exceed expectations. Points are on the 0–100 career-score scale.</>
                ) : (
                  <>Showing <strong>{shown.length}</strong> of the top {list.length}. Ranks inside overlapping ranges aren’t meaningfully different.</>
                )
              ) : (
                "Loading rankings…"
              )}
            </p>
            {list && shown.length === 0 && <EmptyState onClear={clearFilters} />}
            {list && shown.length > 0 && (query.view === "beats" ? <BeatsView schools={shown} /> : <OverallView schools={shown} onOpenMajor={openMajor} />)}
          </>
        )}

        {meta && <Methodology weights={meta.weights} />}
      </div>
    </WorkspaceShell>
  );
}
