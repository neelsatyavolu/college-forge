"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import "./rankings.css";

type School = {
  rank: number;
  rank_low?: number | null;
  rank_high?: number | null;
  unitid: number;
  institution: string;
  city?: string;
  state: string;
  control?: string;
  composite_score?: number | null;
  value_pctile?: number | null;
  reputation_pctile?: number | null;
  earnings_actual_mix?: number | null;
  value_metric?: number | null;
  rpp_grad?: number | null;
  rpp_local?: number | null;
  grad_feeder_flag?: boolean | string;
  value_added?: number | null;
  value_added_rank?: number;
  net_price?: number | null;
  earnings_10yr?: number | null;
};

type MajorRow = {
  cip_code: string;
  cip_desc: string;
  rank_in_major: number;
  institution: string;
  state: string | null;
  value_metric_cip: number | null;
  earnings_cip: number | null;
  unitid: number | null;
  institution_rank: number | null;
};

type MajorIndex = { cip_code: string; cip_desc: string; n: number };

type ViewMode = "composite" | "major" | "value_added";
type SortKey =
  | "rank"
  | "institution"
  | "composite_score"
  | "value_metric"
  | "earnings_actual_mix"
  | "rpp_grad"
  | "value_pctile"
  | "reputation_pctile"
  | "value_added";

function money(n: number | null | undefined, compact = true): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (!compact) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  }
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

function pct1(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(1);
}

function isFeeder(v: boolean | string | null | undefined): boolean {
  return v === true || v === "True" || v === "true";
}

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cf.theme");
      const dark = saved
        ? saved === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      const t = dark ? "dark" : "light";
      setTheme(t);
      document.documentElement.setAttribute("data-theme", t);
    } catch {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("cf.theme", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

function useQueryState() {
  const read = () => {
    if (typeof window === "undefined") {
      return { view: "composite" as ViewMode, q: "", state: "", major: "", control: "" };
    }
    const p = new URLSearchParams(window.location.search);
    return {
      view: (p.get("view") as ViewMode) || "composite",
      q: p.get("q") || "",
      state: p.get("state") || "",
      major: p.get("major") || "",
      control: p.get("control") || "",
    };
  };
  const [qs, setQs] = useState(read);
  useEffect(() => {
    const onPop = () => setQs(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const update = useCallback((patch: Partial<ReturnType<typeof read>>) => {
    setQs((prev) => {
      const next = { ...prev, ...patch };
      const p = new URLSearchParams();
      if (next.view && next.view !== "composite") p.set("view", next.view);
      if (next.q) p.set("q", next.q);
      if (next.state) p.set("state", next.state);
      if (next.major) p.set("major", next.major);
      if (next.control) p.set("control", next.control);
      const s = p.toString();
      const url = s ? `?${s}` : window.location.pathname;
      window.history.replaceState(null, "", url);
      return next;
    });
  }, []);
  return [qs, update] as const;
}

export default function RankingsClient() {
  const [theme, toggleTheme] = useTheme();
  const [qs, setQs] = useQueryState();
  const [schools, setSchools] = useState<School[]>([]);
  const [valueAdded, setValueAdded] = useState<School[]>([]);
  const [majorIndex, setMajorIndex] = useState<MajorIndex[]>([]);
  const [majorRows, setMajorRows] = useState<MajorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, va, mi, mr] = await Promise.all([
          fetch("/data/rankings/top250.json").then((r) => r.json()),
          fetch("/data/rankings/value_added.json").then((r) => r.json()),
          fetch("/data/rankings/majors_index.json").then((r) => r.json()),
          fetch("/data/rankings/by_major_top25.json").then((r) => r.json()),
        ]);
        if (cancelled) return;
        setSchools(t.schools || []);
        setValueAdded(va.schools || []);
        setMajorIndex(mi.majors || []);
        setMajorRows(mr.rows || []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load rankings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const states = useMemo(() => {
    const s = new Set(schools.map((x) => x.state).filter(Boolean));
    return Array.from(s).sort();
  }, [schools]);

  const medianValue = useMemo(() => {
    const vals = schools
      .map((s) => s.value_metric)
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
    if (!vals.length) return null;
    return vals[Math.floor(vals.length / 2)];
  }, [schools]);

  const filtered = useMemo(() => {
    const q = qs.q.trim().toLowerCase();
    return schools.filter((s) => {
      if (qs.state && s.state !== qs.state) return false;
      if (qs.control === "public" && s.control !== "public") return false;
      if (qs.control === "private" && s.control !== "private_nonprofit") return false;
      if (!q) return true;
      const hay = `${s.institution} ${s.city} ${s.state}`.toLowerCase();
      return hay.includes(q);
    });
  }, [schools, qs.q, qs.state, qs.control]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const ak = a[sortKey];
      const bk = b[sortKey];
      if (ak == null && bk == null) return 0;
      if (ak == null) return 1;
      if (bk == null) return -1;
      if (typeof ak === "string" && typeof bk === "string") {
        return ak.localeCompare(bk) * dir;
      }
      return ((ak as number) - (bk as number)) * dir;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const majorFiltered = useMemo(() => {
    if (!qs.major) return [];
    const q = qs.q.trim().toLowerCase();
    return majorRows
      .filter((r) => r.cip_code === qs.major)
      .filter((r) => {
        if (!q) return true;
        return `${r.institution} ${r.state || ""}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.rank_in_major - b.rank_in_major);
  }, [majorRows, qs.major, qs.q]);

  const vaFiltered = useMemo(() => {
    const q = qs.q.trim().toLowerCase();
    return valueAdded.filter((s) => {
      if (qs.state && s.state !== qs.state) return false;
      if (!q) return true;
      return `${s.institution} ${s.state}`.toLowerCase().includes(q);
    });
  }, [valueAdded, qs.q, qs.state]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "institution" || key === "rank" ? "asc" : "desc");
    }
  };

  const clearFilters = () => setQs({ q: "", state: "", control: "", major: qs.view === "major" ? qs.major : "" });

  const activeChips: { label: string; clear: () => void }[] = [];
  if (qs.q) activeChips.push({ label: `“${qs.q}”`, clear: () => setQs({ q: "" }) });
  if (qs.state) activeChips.push({ label: qs.state, clear: () => setQs({ state: "" }) });
  if (qs.control)
    activeChips.push({
      label: qs.control === "public" ? "Public" : "Private nonprofit",
      clear: () => setQs({ control: "" }),
    });

  if (loading) {
    return (
      <div className="rk-page" data-theme={theme}>
        <div className="rk-loading">Loading rankings…</div>
      </div>
    );
  }
  if (err) {
    return (
      <div className="rk-page" data-theme={theme}>
        <div className="rk-empty">{err}</div>
      </div>
    );
  }

  const selectedMajor = majorIndex.find((m) => m.cip_code === qs.major);

  return (
    <div className="rk-page" data-theme={theme}>
      <div className="rk-shell">
        <div className="rk-topbar">
          <a className="rk-brand" href="/hub/index.html">
            <span className="rk-brand__mark" aria-hidden>
              ✱
            </span>
            College Forge
          </a>
          <div className="rk-topbar__links">
            <a href="/hub/index.html#explore">Hub</a>
            <a href="#methodology">Methodology</a>
            <button
              type="button"
              onClick={toggleTheme}
              style={{
                appearance: "none",
                border: 0,
                background: "transparent",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            >
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </div>

        <header className="rk-masthead">
          <p className="rk-kicker">Purchasing-power ranking · 2026</p>
          <h1 className="rk-title">What a degree is worth where graduates actually live</h1>
          <p className="rk-lede">
            Earnings deflated by the cost of living in the places graduates work — not near campus —
            then blended with an objective reputation measure. Tuition does not enter the score.
          </p>
          <div className="rk-stats" role="group" aria-label="Summary stats">
            <div className="rk-stat">
              <p className="rk-stat__label">Schools ranked</p>
              <p className="rk-stat__value">{schools.length}</p>
            </div>
            <div className="rk-stat">
              <p className="rk-stat__label">Majors scored</p>
              <p className="rk-stat__value">{majorIndex.length}</p>
            </div>
            <div className="rk-stat">
              <p className="rk-stat__label">Median value</p>
              <p className="rk-stat__value" title={money(medianValue, false)}>
                {money(medianValue)}
              </p>
            </div>
            <div className="rk-stat">
              <p className="rk-stat__label">Data vintage</p>
              <p className="rk-stat__value">2024$</p>
            </div>
          </div>
        </header>

        <div className="rk-controls">
          <div className="rk-controls__row">
            <div className="rk-seg" role="tablist" aria-label="Ranking view">
              <button
                type="button"
                role="tab"
                aria-pressed={qs.view === "composite"}
                onClick={() => setQs({ view: "composite", major: "" })}
              >
                Overall
              </button>
              <button
                type="button"
                role="tab"
                aria-pressed={qs.view === "major"}
                onClick={() =>
                  setQs({
                    view: "major",
                    major: qs.major || majorIndex[0]?.cip_code || "",
                  })
                }
              >
                By major
              </button>
              <button
                type="button"
                role="tab"
                aria-pressed={qs.view === "value_added"}
                onClick={() => setQs({ view: "value_added", major: "" })}
              >
                Value-added
              </button>
            </div>

            <input
              className="rk-search"
              type="search"
              placeholder="Search school or state…"
              value={qs.q}
              onChange={(e) => setQs({ q: e.target.value })}
              aria-label="Search schools"
            />

            {qs.view === "major" ? (
              <select
                className="rk-select"
                value={qs.major}
                onChange={(e) => setQs({ major: e.target.value })}
                aria-label="Major"
                style={{ maxWidth: 280 }}
              >
                {majorIndex.map((m) => (
                  <option key={m.cip_code} value={m.cip_code}>
                    {m.cip_desc.replace(/\.$/, "")} ({m.n})
                  </option>
                ))}
              </select>
            ) : (
              <>
                <select
                  className="rk-select"
                  value={qs.state}
                  onChange={(e) => setQs({ state: e.target.value })}
                  aria-label="State"
                >
                  <option value="">All states</option>
                  {states.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {qs.view === "composite" && (
                  <select
                    className="rk-select"
                    value={qs.control}
                    onChange={(e) => setQs({ control: e.target.value })}
                    aria-label="Control"
                  >
                    <option value="">Public + private</option>
                    <option value="public">Public</option>
                    <option value="private">Private nonprofit</option>
                  </select>
                )}
              </>
            )}

            {qs.view === "composite" && (
              <button
                type="button"
                className="rk-detail-toggle"
                aria-pressed={detail}
                onClick={() => setDetail((d) => !d)}
              >
                {detail ? "Hide detail" : "Show detail"}
              </button>
            )}
          </div>

          <div className="rk-meta-line">
            <span>
              {qs.view === "composite" && (
                <>
                  Showing <strong>{sorted.length}</strong> of {schools.length} · Ranks within overlapping
                  intervals are not meaningfully different
                </>
              )}
              {qs.view === "major" && selectedMajor && (
                <>
                  <strong>{selectedMajor.cip_desc.replace(/\.$/, "")}</strong> · top{" "}
                  {majorFiltered.length} by purchasing-power earnings · reputation not scored
                </>
              )}
              {qs.view === "value_added" && (
                <>
                  Residual after controlling for SAT/ACT, Pell, first-gen, admit rate, region ·{" "}
                  <strong>{vaFiltered.length}</strong> schools
                </>
              )}
            </span>
            {activeChips.length > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                style={{
                  appearance: "none",
                  border: 0,
                  background: "transparent",
                  color: "var(--coral)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          {activeChips.length > 0 && (
            <div className="rk-chips">
              {activeChips.map((c) => (
                <span className="rk-chip" key={c.label}>
                  {c.label}
                  <button type="button" onClick={c.clear} aria-label={`Remove ${c.label}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {qs.view === "composite" && (
          <>
            <div className="rk-table-wrap">
              <table className="rk-table">
                <thead>
                  <tr>
                    <th className="num" style={{ cursor: "pointer" }} onClick={() => toggleSort("rank")}>
                      Rank
                    </th>
                    <th style={{ cursor: "pointer" }} onClick={() => toggleSort("institution")}>
                      Institution
                    </th>
                    <th className="num" style={{ cursor: "pointer" }} onClick={() => toggleSort("composite_score")}>
                      Composite
                    </th>
                    <th className="num" style={{ cursor: "pointer" }} onClick={() => toggleSort("value_metric")}>
                      Value $
                    </th>
                    {detail && (
                      <>
                        <th className="num" style={{ cursor: "pointer" }} onClick={() => toggleSort("earnings_actual_mix")}>
                          Earnings
                        </th>
                        <th className="num" style={{ cursor: "pointer" }} onClick={() => toggleSort("rpp_grad")}>
                          RPP
                        </th>
                        <th className="num" style={{ cursor: "pointer" }} onClick={() => toggleSort("value_pctile")}>
                          Val %
                        </th>
                        <th className="num" style={{ cursor: "pointer" }} onClick={() => toggleSort("reputation_pctile")}>
                          Rep %
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s) => (
                    <tr key={s.unitid}>
                      <td className="num">
                        <div className="rk-rank">
                          <span className={`rk-rank__n${s.rank <= 10 ? " top10" : ""}`}>{s.rank}</span>
                          {s.rank_low != null && s.rank_high != null && (
                            <span className="rk-rank__band">
                              {Math.round(s.rank_low)}–{Math.round(s.rank_high)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="rk-school">
                          <span className="rk-school__name">
                            {s.institution}
                            {isFeeder(s.grad_feeder_flag) && (
                              <span className="rk-feeder" title="High share of grads in further education; 4yr earnings understate outcomes">
                                Feeder
                              </span>
                            )}
                          </span>
                          <span className="rk-school__meta">
                            {s.city}, {s.state}
                            {s.control === "public" ? " · Public" : " · Private"}
                          </span>
                        </div>
                      </td>
                      <td className="num">
                        <span className="rk-composite">
                          <span
                            className="rk-composite__bar"
                            style={{
                              width: `${Math.max(8, Math.min(100, s.composite_score ?? 0))}%`,
                            }}
                          />
                          <span className="rk-composite__n">{pct1(s.composite_score ?? null)}</span>
                        </span>
                      </td>
                      <td className="num" title={money(s.value_metric, false)}>
                        {money(s.value_metric)}
                      </td>
                      {detail && (
                        <>
                          <td className="num" title={money(s.earnings_actual_mix, false)}>
                            {money(s.earnings_actual_mix)}
                          </td>
                          <td className="num">{s.rpp_grad != null ? s.rpp_grad.toFixed(1) : "—"}</td>
                          <td className="num">{pct1(s.value_pctile)}</td>
                          <td className="num">{pct1(s.reputation_pctile)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {sorted.length === 0 && <div className="rk-empty">No schools match these filters.</div>}
            </div>

            <div className="rk-cards">
              {sorted.map((s) => (
                <article className="rk-card" key={s.unitid}>
                  <div className="rk-rank">
                    <span className={`rk-rank__n${s.rank <= 10 ? " top10" : ""}`}>{s.rank}</span>
                    {s.rank_low != null && s.rank_high != null && (
                      <span className="rk-rank__band">
                        {Math.round(s.rank_low)}–{Math.round(s.rank_high)}
                      </span>
                    )}
                  </div>
                  <div className="rk-school">
                    <span className="rk-school__name">
                      {s.institution}
                      {isFeeder(s.grad_feeder_flag) && <span className="rk-feeder">Feeder</span>}
                    </span>
                    <span className="rk-school__meta">
                      {s.city}, {s.state}
                    </span>
                  </div>
                  <div className="rk-card__metrics">
                    <div className="rk-card__metric">
                      <label>Composite</label>
                      <span>{pct1(s.composite_score)}</span>
                    </div>
                    <div className="rk-card__metric">
                      <label>Value $</label>
                      <span title={money(s.value_metric, false)}>{money(s.value_metric)}</span>
                    </div>
                    <div className="rk-card__metric">
                      <label>RPP</label>
                      <span>{s.rpp_grad != null ? s.rpp_grad.toFixed(1) : "—"}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {qs.view === "major" && (
          <>
            <div className="rk-table-wrap">
              <table className="rk-table">
                <thead>
                  <tr>
                    <th className="num">Rank</th>
                    <th>Institution</th>
                    <th className="num">Value $</th>
                    <th className="num">Earnings</th>
                    <th className="num">Overall #</th>
                  </tr>
                </thead>
                <tbody>
                  {majorFiltered.map((r) => (
                    <tr key={`${r.cip_code}-${r.unitid}-${r.rank_in_major}`}>
                      <td className="num">
                        <span className={`rk-rank__n${r.rank_in_major <= 10 ? " top10" : ""}`}>
                          {r.rank_in_major}
                        </span>
                      </td>
                      <td>
                        <div className="rk-school">
                          <span className="rk-school__name">{r.institution}</span>
                          <span className="rk-school__meta">{r.state || ""}</span>
                        </div>
                      </td>
                      <td className="num" title={money(r.value_metric_cip, false)}>
                        {money(r.value_metric_cip)}
                      </td>
                      <td className="num" title={money(r.earnings_cip, false)}>
                        {money(r.earnings_cip)}
                      </td>
                      <td className="num">{r.institution_rank ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rk-cards">
              {majorFiltered.map((r) => (
                <article className="rk-card" key={`c-${r.cip_code}-${r.unitid}`}>
                  <div className="rk-rank">
                    <span className={`rk-rank__n${r.rank_in_major <= 10 ? " top10" : ""}`}>
                      {r.rank_in_major}
                    </span>
                  </div>
                  <div className="rk-school">
                    <span className="rk-school__name">{r.institution}</span>
                    <span className="rk-school__meta">{r.state || ""}</span>
                  </div>
                  <div className="rk-card__metrics">
                    <div className="rk-card__metric">
                      <label>Value $</label>
                      <span>{money(r.value_metric_cip)}</span>
                    </div>
                    <div className="rk-card__metric">
                      <label>Earnings</label>
                      <span>{money(r.earnings_cip)}</span>
                    </div>
                    <div className="rk-card__metric">
                      <label>Overall</label>
                      <span>#{r.institution_rank ?? "—"}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {qs.view === "value_added" && (
          <>
            <div className="rk-table-wrap">
              <table className="rk-table">
                <thead>
                  <tr>
                    <th className="num">VA rank</th>
                    <th>Institution</th>
                    <th className="num">Value-added</th>
                    <th className="num">Value $</th>
                    <th className="num">Overall #</th>
                  </tr>
                </thead>
                <tbody>
                  {vaFiltered.map((s, i) => (
                    <tr key={s.unitid}>
                      <td className="num">
                        <span className={`rk-rank__n${i < 10 ? " top10" : ""}`}>
                          {s.value_added_rank ?? i + 1}
                        </span>
                      </td>
                      <td>
                        <div className="rk-school">
                          <span className="rk-school__name">{s.institution}</span>
                          <span className="rk-school__meta">{s.state}</span>
                        </div>
                      </td>
                      <td className="num" title={money(s.value_added, false)}>
                        {s.value_added != null && s.value_added > 0 ? "+" : ""}
                        {money(s.value_added)}
                      </td>
                      <td className="num">{money(s.value_metric)}</td>
                      <td className="num">{s.rank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rk-cards">
              {vaFiltered.map((s, i) => (
                <article className="rk-card" key={`va-${s.unitid}`}>
                  <div className="rk-rank">
                    <span className={`rk-rank__n${i < 10 ? " top10" : ""}`}>
                      {s.value_added_rank ?? i + 1}
                    </span>
                  </div>
                  <div className="rk-school">
                    <span className="rk-school__name">{s.institution}</span>
                    <span className="rk-school__meta">{s.state}</span>
                  </div>
                  <div className="rk-card__metrics">
                    <div className="rk-card__metric">
                      <label>Value-added</label>
                      <span>{money(s.value_added)}</span>
                    </div>
                    <div className="rk-card__metric">
                      <label>Value $</label>
                      <span>{money(s.value_metric)}</span>
                    </div>
                    <div className="rk-card__metric">
                      <label>Overall</label>
                      <span>#{s.rank}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        <section className="rk-method" id="methodology">
          <h2>How this ranking works</h2>
          <p>
            The score answers one question: if you graduate from this school, how far will your paycheck
            go where you&apos;re likely to end up living — and how well-regarded is the place that got
            you there?
          </p>
          <div className="rk-formula">
            Composite = 0.70 × percentile(earnings ÷ graduate-weighted RPP)
            <br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ 0.30 × percentile(reputation)
          </div>
          <p>
            <strong style={{ color: "var(--ink)", fontWeight: 500 }}>Value (70%).</strong> Median
            bachelor&apos;s earnings four years after completion (College Scorecard field-of-study),
            weighted by each school&apos;s major mix, deflated by BEA Regional Price Parities weighted
            toward where graduates actually work (Census PSEO where available; modeled retention
            otherwise). Dollars are in 2024 national-average purchasing power.
          </p>
          <p>
            <strong style={{ color: "var(--ink)", fontWeight: 500 }}>Reputation (30%).</strong> Yield
            rate (IPEDS), research standing (OpenAlex, percentile within Carnegie class), and student
            outcomes (retention + six-year completion). Not a peer survey.
          </p>
          <p>
            <strong style={{ color: "var(--ink)", fontWeight: 500 }}>Feeder</strong> marks schools
            above the 80th percentile for non-working share at the four-year mark — often graduate
            school. Their four-year earnings understate eventual outcomes; we flag, not adjust.
          </p>
          <p>Tuition and net price are shown for context only. They never enter the score.</p>

          <h2 style={{ marginTop: 36 }}>Disclosures</h2>
          <ol>
            <li>
              Earnings cover only federal aid recipients and are not representative of all graduates,
              especially at wealthy institutions.
            </li>
            <li>
              Graduate employment locations are observed for a subset of schools (PSEO) and modeled
              for the rest.
            </li>
            <li>Earnings reflect cohorts who graduated several years ago.</li>
            <li>Rank differences within overlapping intervals are not meaningful.</li>
            <li>Reputation is constructed from public data, not opinion surveys.</li>
            <li>Only bachelor&apos;s degrees are scored.</li>
            <li>For-profit institutions are excluded.</li>
            <li>
              This measures earnings and prestige — not teaching quality, wellbeing, or fit for any
              individual student.
            </li>
          </ol>
          <p style={{ marginTop: 16 }}>
            Full pipeline and sources live in the repo under <code>ranking/</code>. Data files:{" "}
            <a href="/data/rankings/sources.md">sources</a> ·{" "}
            <a href="/data/rankings/DISCLOSURE.md">disclosure</a>.
          </p>
        </section>

        <footer className="rk-footer">
          <span>
            Composite = 70% purchasing-power value + 30% reputation · for-profits excluded · top 250 of
            eligible universe
          </span>
          <span>
            <a href="/hub/index.html" style={{ color: "var(--muted)" }}>
              Back to hub
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}
