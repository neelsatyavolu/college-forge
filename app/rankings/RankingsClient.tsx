"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CareerAi } from "@/lib/career-ai";
import type { CareerSettings as SavedSettings } from "@/lib/career-settings";
import { DEFAULT_WEIGHTS, PILLARS, createRanker, type CareerData, type Student, type Weights } from "@/lib/career-ranking";
import AiImport from "./AiImport";
import AiList from "./AiList";
import CareerList from "./CareerList";
import CareerSettings, { DEFAULT_FLAGS, type Flags } from "./CareerSettings";
import { useJson, useStored, useTheme } from "./hooks";
import Methodology from "./Methodology";
import WorkspaceShell from "./WorkspaceShell";
import "./rankings.css";

type Me = { workspace: boolean; account?: boolean; intended: string[]; schools: { id: number; major: string[]; admitted: boolean }[]; ai?: CareerAi | null; settings?: SavedSettings | null };
const EMPTY_ME: Me = { workspace: false, account: false, intended: [], schools: [], ai: null, settings: null };

/**
 * Saves setting changes on the student's workspace (PUT /api/rankings/me) a moment after the last one,
 * so the iOS app and the List tab rank the same way. The browser copy still applies if saving fails.
 */
function useSettingsSaver(): (s: SavedSettings) => void {
  const pending = useRef<SavedSettings>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback((s: SavedSettings) => {
    pending.current = { ...pending.current, ...s };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const body = pending.current;
      pending.current = {};
      fetch("/api/rankings/me", {
        method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }).catch(() => undefined);
    }, 600);
  }, []);
}

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
  const [meLoaded, setMeLoaded] = useState(false);
  const [view, setViewState] = useState("path");
  const [weights, setWeights, weightsStored] = useStored<Weights>("cf.career.weights", DEFAULT_WEIGHTS, isWeights);
  const [flags, setFlags, flagsStored] = useStored<Flags>("cf.career.flags", DEFAULT_FLAGS, isFlags);
  const [picked, setPicked, pickedStored] = useStored<string[]>("cf.career.targets", [], isStrings);
  const saveSettings = useSettingsSaver();
  const changeWeights = useCallback((w: Weights) => { setWeights(w); saveSettings({ weights: w }); }, [setWeights, saveSettings]);
  const changeFlags = useCallback((f: Flags) => { setFlags(f); saveSettings({ flags: f }); }, [setFlags, saveSettings]);
  const changeTargets = useCallback((t: string[]) => { setPicked(t); saveSettings({ targets: t }); }, [setPicked, saveSettings]);

  useEffect(() => {
    setViewState(readView());
    let live = true;
    fetch("/api/rankings/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : EMPTY_ME))
      .then((m: Me) => { if (live) { setMe(m && Array.isArray(m.schools) ? m : EMPTY_ME); setMeLoaded(true); } })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  // Once the workspace answers: its saved settings win over this browser's copy, and settings only this
  // browser had (from before they were saved on the workspace) are saved there.
  const synced = useRef(false);
  useEffect(() => {
    if (!meLoaded || synced.current) return;
    synced.current = true;
    const s = me.settings ?? {};
    if (s.targets?.length) setPicked(s.targets);
    if (s.weights) setWeights(s.weights);
    if (s.flags) setFlags(s.flags);
    const local: SavedSettings = {
      ...(!s.targets?.length && pickedStored && picked.length ? { targets: picked } : {}),
      ...(!s.weights && weightsStored ? { weights } : {}),
      ...(!s.flags && flagsStored ? { flags } : {}),
    };
    if (me.workspace && Object.keys(local).length) saveSettings(local);
  }, [meLoaded, me, picked, pickedStored, weights, weightsStored, flags, flagsStored, setPicked, setWeights, setFlags, saveSettings]);

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
  // A student with schools on their list sees just those, ranked among themselves on the full list's scale.
  const mine = useMemo(() => (me.schools.length ? new Set(me.schools.map((s) => s.id)) : undefined), [me]);
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
  // Fades the tab row's right edge while more tabs are scrolled out of view.
  const tabsRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const check = () => setClipped(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("scroll", check, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", check); };
  }, [tabs]);

  const result = useMemo(() => {
    if (!ranker) return null;
    if (isAi) {
      // The formula's My path rank at default settings, to set beside the judged order.
      const st = { track: "path", ...DEFAULT_FLAGS, w: { ...DEFAULT_WEIGHTS } };
      return { rows: [], pathRanks: null, formula: new Map(ranker.rank(st, student).map((r) => [r.s.id, r.rk])) };
    }
    const st = { track: isPath ? "path" : active, ...flags, w: weights };
    const rows = ranker.rank(st, student, isAdmitted ? admitted : mine);
    const pathRanks = isAdmitted ? new Map(ranker.rank(st, student, mine).map((r) => [r.s.id, r.rk])) : null;
    return { rows, pathRanks, formula: null };
  }, [ranker, active, isPath, isAdmitted, isAi, flags, weights, student, admitted, mine]);

  const total = data.data?.schools.length ?? 0;
  const title = isAi ? "Your judged list" : isAdmitted ? "Schools you got into" : isPath ? "Ranked by the majors you can reach" : active === "overall" ? "Ranked on all majors" : `Ranked on ${majors.find((m) => m.key === active)?.label.toLowerCase()}`;
  const missing = !isPath && !isAi && data.data && ranker ? data.data.schools.filter((s) => (!mine || mine.has(s.id)) && !ranker.has(s, active)).map((s) => s.name) : [];

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
          <div ref={tabsRef} className={"rk-tabs" + (clipped ? " is-clipped" : "")} role="tablist" aria-label="Ranking view">
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
            onTargets={changeTargets}
            weights={weights}
            onWeights={changeWeights}
            flags={flags}
            onFlags={changeFlags}
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
