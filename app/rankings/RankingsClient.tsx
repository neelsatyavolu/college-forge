"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CareerAi } from "@/lib/career-ai";
import { DEFAULT_WEIGHTS, PILLARS, createRanker, type CareerData, type Student, type Weights } from "@/lib/career-ranking";
import AiImport from "./AiImport";
import AiList from "./AiList";
import CareerList from "./CareerList";
import CareerSettings, { DEFAULT_FLAGS, type Flags } from "./CareerSettings";
import { useJson, useStored, useTheme } from "./hooks";
import Methodology from "./Methodology";
import WorkspaceShell from "./WorkspaceShell";
import "./rankings.css";

type Me = { workspace: boolean; account?: boolean; intended: string[]; schools: { id: number; major: string[]; admitted: boolean }[]; ai?: CareerAi | null };
const EMPTY_ME: Me = { workspace: false, account: false, intended: [], schools: [], ai: null };

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isWeights = (v: unknown): v is Weights =>
  !!v && typeof v === "object" && PILLARS.every((k) => typeof (v as Record<string, unknown>)[k] === "number") && PILLARS.some((k) => (v as Record<string, number>)[k] > 0);
const isFlags = (v: unknown): v is Flags =>
  !!v && typeof v === "object" && (["col", "va", "stretch"] as const).every((k) => typeof (v as Record<string, unknown>)[k] === "boolean");

function readView(): string {
  if (typeof window === "undefined") return "path";
  return new URLSearchParams(window.location.search).get("view") || "path";
}

export default function RankingsClient() {
  const [theme, toggleTheme] = useTheme();
  const data = useJson<CareerData>("/data/career-ranking.json");
  const [me, setMe] = useState<Me>(EMPTY_ME);
  const [view, setViewState] = useState("path");
  const [weights, setWeights] = useStored<Weights>("cf.career.weights", DEFAULT_WEIGHTS, isWeights);
  const [flags, setFlags] = useStored<Flags>("cf.career.flags", DEFAULT_FLAGS, isFlags);
  const [picked, setPicked, pickedStored] = useStored<string[]>("cf.career.targets", [], isStrings);

  useEffect(() => {
    setViewState(readView());
    let live = true;
    fetch("/api/rankings/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : EMPTY_ME))
      .then((m: Me) => live && setMe(m && Array.isArray(m.schools) ? m : EMPTY_ME))
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  const setView = useCallback((v: string) => {
    setViewState(v);
    const p = new URLSearchParams(window.location.search);
    if (v === "path") p.delete("view"); else p.set("view", v);
    const s = p.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  }, []);

  const ranker = useMemo(() => (data.data ? createRanker(data.data) : null), [data.data]);
  const majors = useMemo(() => (data.data?.meta.majors ?? []).filter((m) => m.target), [data.data]);
  const admitted = useMemo(() => new Set(me.schools.filter((s) => s.admitted).map((s) => s.id)), [me]);
  // Targets: what this browser saved, else the intended major on the student's profile, else every major.
  const targets = useMemo(() => {
    const all = majors.map((m) => m.key);
    const from = pickedStored && picked.length ? picked : me.intended.length ? me.intended : all;
    const ok = from.filter((k) => all.includes(k));
    return ok.length ? ok : all;
  }, [majors, picked, pickedStored, me.intended]);
  const student: Student = useMemo(() => ({
    targets,
    direct: Object.fromEntries(
      me.schools.map((s) => [s.id, s.major.filter((k) => targets.includes(k))] as const).filter(([, k]) => k.length > 0),
    ),
  }), [targets, me.schools]);

  const tabs = useMemo(() => [
    { id: "path", label: "My path" },
    ...(admitted.size ? [{ id: "admitted", label: "Admitted" }] : []),
    ...(me.ai ? [{ id: "ai", label: "AI My Path" }] : []),
    { id: "overall", label: "All majors" },
    ...majors.filter((m) => m.tab).map((m) => ({ id: m.key, label: m.tab! })),
  ], [majors, admitted.size, me.ai]);
  // Majors without a tab of their own are picked from a menu next to the tabs.
  const more = useMemo(() => majors.filter((m) => !m.tab).sort((a, b) => a.label.localeCompare(b.label)), [majors]);
  const active = tabs.some((t) => t.id === view) || more.some((m) => m.key === view) ? view : "path";
  const isAi = active === "ai", isAdmitted = active === "admitted", isPath = active === "path" || isAdmitted;

  const result = useMemo(() => {
    if (!ranker) return null;
    if (isAi) {
      // The formula's My path rank at default settings, to set beside the judged order.
      const st = { track: "path", ...DEFAULT_FLAGS, w: { ...DEFAULT_WEIGHTS } };
      return { rows: [], pathRanks: null, formula: new Map(ranker.rank(st, student).map((r) => [r.s.id, r.rk])) };
    }
    const st = { track: isPath ? "path" : active, ...flags, w: weights };
    const rows = ranker.rank(st, student, isAdmitted ? admitted : undefined);
    const pathRanks = isAdmitted ? new Map(ranker.rank(st, student).map((r) => [r.s.id, r.rk])) : null;
    return { rows, pathRanks, formula: null };
  }, [ranker, active, isPath, isAdmitted, isAi, flags, weights, student, admitted]);

  const total = data.data?.schools.length ?? 0;
  const title = isAi ? "Your judged list" : isAdmitted ? "Schools you got into" : isPath ? "Ranked by the majors you can reach" : active === "overall" ? "Ranked on all majors" : `Ranked on ${majors.find((m) => m.key === active)?.label.toLowerCase()}`;
  const missing = !isPath && !isAi && data.data && ranker ? data.data.schools.filter((s) => !ranker.has(s, active)).map((s) => s.name) : [];

  return (
    <WorkspaceShell theme={theme} onToggleTheme={toggleTheme} topline={`${total || "…"} colleges · cost never counts`}>
      <div className="cf-page rk-page" id="rankings-top">
        <header className="rk-header">
          <h1 className="cf-page-title">Where you’d be set up best</h1>
          <p className="rk-lede">
            Pay in the majors you can reach, how far the name carries, landing work, and campus life, from federal
            records and published grades. Cost, aid and debt never count. <a href="#methodology">How it works</a>
          </p>
        </header>

        <div className="rk-toolbar">
          <div className="rk-tabs" role="tablist" aria-label="Ranking view">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={active === t.id} className="rk-tab" onClick={() => setView(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {more.length > 0 && (
            <select
              className="rk-more"
              aria-label="Rank one more major"
              value={more.some((m) => m.key === active) ? active : ""}
              onChange={(e) => e.target.value && setView(e.target.value)}
            >
              <option value="">More majors…</option>
              {more.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          )}
        </div>

        {data.error && <div className="cf-notice" role="alert">{data.error}</div>}

        {data.data && (
          <CareerSettings
            majors={majors}
            targets={targets}
            onTargets={setPicked}
            weights={weights}
            onWeights={setWeights}
            flags={flags}
            onFlags={setFlags}
            showTargets={isPath}
          >
            {me.account && <AiImport ai={me.ai ?? null} onChange={(ai) => { setMe((m) => ({ ...m, ai })); if (!ai && isAi) setView("path"); }} />}
          </CareerSettings>
        )}

        <h2 className="rk-listtitle">{title}</h2>
        {isAi && me.ai && data.data && result?.formula ? (
          <>
            <p className="rk-resultline">
              <strong>{me.ai.list.length}</strong> schools, ranked by hand{me.ai.made ? ` (${me.ai.made})` : ""}. Formula is your My path rank at default settings. Only you can see this list.
            </p>
            {me.ai.about && (
              <details className="rk-details rk-ai__about">
                <summary>About this list</summary>
                <p>{me.ai.about}</p>
              </details>
            )}
            <AiList ai={me.ai} schools={data.data.schools} formula={result.formula} admitted={admitted} />
          </>
        ) : (<>
        <p className="rk-resultline">
          {!result ? "Loading the ranking…" : (
            <>
              <strong>{result.rows.length}</strong> {result.rows.length === 1 ? "school" : "schools"}
              {isAdmitted ? ", ranked against each other on the same scale as My path." : isPath ? `. Each is scored on the major you picked that you can reach and where it does best against the same major elsewhere.` : "."}
              {isPath && !me.workspace && " Sign in to count the majors on your applications."}
              {" "}Tap a school for details.
            </>
          )}
        </p>
        {result && (
          <CareerList
            rows={result.rows}
            weights={weights}
            majors={majors}
            path={isPath}
            targets={targets}
            admitted={admitted}
            pathRanks={result.pathRanks}
            col={flags.col}
          />
        )}
        </>)}
        {missing.length > 0 && (
          <p className="rk-resultline rk-missing">
            Not ranked here: {missing.join(", ")}. These schools don’t offer it as a bachelor’s major, or have too few federally aided graduates for pay to be published.
          </p>
        )}

        {data.data && <Methodology count={total} generated={data.data.meta.generated} />}
      </div>
    </WorkspaceShell>
  );
}
