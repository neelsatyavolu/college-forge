const SETTINGS = [
  { id: "all", label: "All" },
  { id: "urban", label: "Urban" },
  { id: "suburban", label: "Suburban" },
  { id: "town", label: "Town" },
  { id: "rural", label: "Rural" },
];

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);

function Thumb({ name, photo }) {
  const [failed, setFailed] = React.useState(false);
  return (
    <span className="cf-explore-thumb cf-img-outline" aria-hidden="true">
      {photo && !failed ? <img src={photo} alt="" loading="lazy" onError={() => setFailed(true)} /> : window.collegeInitials(name)}
    </span>
  );
}

function SchoolRow({ c, selected, favorite, onSelect, onToggleFavorite }) {
  const ranked = typeof c.rank === "number" && c.rank > 0;
  const stats = [c.admit ? `Admit ${c.admit}` : null, c.satRange ? `SAT ${c.satRange}` : null].filter(Boolean).join(" · ");
  const fit = (c.tags || [])[0];
  return (
    <div className="cf-explore-row" role="listitem" aria-current={selected ? "true" : undefined}>
      <button type="button" className="cf-explore-pick" onClick={onSelect}>
        <span className={"cf-explore-rank" + (ranked ? "" : " is-unranked")} aria-label={ranked ? `Rank ${c.rank}` : "Unranked"}>{ranked ? c.rank : "—"}</span>
        <Thumb name={c.name} photo={c.photo} />
        <span className="cf-explore-text">
          <span className="cf-explore-name">{c.name}</span>
          <span className="cf-explore-sub">{c.location || "Location unavailable"}{c.onList ? <> · <strong>On your list</strong></> : null}</span>
          {stats || fit ? <span className="cf-explore-sub">{stats}{fit ? <>{stats ? " · " : ""}<strong>{fit.label}</strong></> : null}</span> : null}
        </span>
      </button>
      <button type="button" className="cf-explore-fav cf-press" aria-pressed={favorite} aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${c.name}`} onClick={onToggleFavorite}>
        {favorite ? "★" : "☆"}
      </button>
    </div>
  );
}

function Explore({ data, favorites, onToggleFavorite, onWorkspaceChange }) {
  const [q, setQ] = React.useState("");
  const [setting, setSetting] = React.useState("all");
  const [favOnly, setFavOnly] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  // Browse = US News top ~250. Search replaces this when q ≥ 2.
  const [browse, setBrowse] = React.useState(null); // null = loading browse
  const [edition, setEdition] = React.useState("");
  const [results, setResults] = React.useState(null); // null = not searching
  const [searching, setSearching] = React.useState(false);
  const [browseLoading, setBrowseLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [busySlug, setBusySlug] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const myList = data.colleges;
  const searchMode = q.trim().length >= 2;

  // Default list: US News National Universities top ~250 (with photos + ranks).
  React.useEffect(() => {
    let cancelled = false;
    setBrowseLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/colleges/search?browse=1", { credentials: "same-origin" });
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || !j.success) throw new Error(j.error || `Browse failed (${res.status}).`);
        setBrowse(j.data || []);
        setEdition(j.edition || "");
        setError("");
      } catch (e) {
        if (!cancelled) { setError(e.message); setBrowse([]); }
      }
      if (!cancelled) setBrowseLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced live search against the College Scorecard.
  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/colleges/search?q=${encodeURIComponent(term)}`, { credentials: "same-origin" });
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || !j.success) throw new Error(j.error || `Search failed (${res.status}).`);
        setResults(j.data);
        setError("");
      } catch (e) {
        if (!cancelled) { setError(e.message); setResults([]); }
      }
      if (!cancelled) setSearching(false);
    }, 280);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const onListSlugs = new Set(myList.map((c) => c.slug));

  // Search results OR the default US News top ~250 browse list.
  const source = searchMode ? (results || []) : (browse || []);
  const list = source
    .filter((c) => (setting === "all" ? true : c.setting === setting))
    .filter((c) => (favOnly ? favorites.includes(c.slug) : true));

  const current = list.find((c) => c.slug === selected) || list[0] || null;
  const currentId = current ? current.scorecardId : null;

  // Load the full per-school record on demand (programs, tuition, retention…).
  // Keyed by Scorecard id; the light search row renders instantly meanwhile.
  React.useEffect(() => {
    if (!currentId) { setDetail(null); setDetailLoading(false); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    (async () => {
      try {
        const res = await fetch(`/api/colleges/detail?id=${encodeURIComponent(currentId)}`, { credentials: "same-origin" });
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || !j.success) throw new Error(j.error || `Lookup failed (${res.status}).`);
        // Keep browse-row photo/rank if detail is missing them.
        const d = j.data || {};
        setDetail({
          ...d,
          photo: d.photo || current.photo || null,
          rank: d.rank ?? current.rank,
        });
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setDetailLoading(false);
    })();
    return () => { cancelled = true; };
  }, [currentId]);

  const addCollege = async (c) => {
    setBusySlug(c.slug); setError("");
    try {
      // Persist the full detail record when we have it, so the saved school
      // keeps tuition/retention/etc. — but never the bulky programs array,
      // which is re-fetched from Scorecard on demand.
      const rich = detail && detail.slug === c.slug ? detail : c;
      const { onList, programs, ...college } = rich;
      const res = await fetch("/api/workspace/colleges", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ college }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Could not add.");
      if (onWorkspaceChange) await onWorkspaceChange();
    } catch (e) { setError(e.message); }
    setBusySlug(null);
  };

  const removeCollege = async (c) => {
    setBusySlug(c.slug); setError("");
    try {
      const res = await fetch(`/api/workspace/colleges?slug=${encodeURIComponent(c.slug)}`, {
        method: "DELETE", credentials: "same-origin",
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Could not remove.");
      if (onWorkspaceChange) await onWorkspaceChange();
    } catch (e) { setError(e.message); }
    setBusySlug(null);
  };

  const rankingName = `U.S. News ${edition ? edition + " " : ""}National Universities`;
  const count = `${list.length} ${searchMode ? "result" : "school"}${list.length === 1 ? "" : "s"}`;
  const listLabel = searching
    ? "Searching…"
    : searchMode
      ? `${count} for “${q.trim()}”`
      : browseLoading
        ? "Loading the ranking…"
        : `${count} · ranked by ${rankingName}`;

  const selectSchool = (slug) => {
    setSelected(slug);
    if (window.matchMedia("(max-width: 960px)").matches) document.querySelector(".cf-split__detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <div className="cf-eyebrow" style={{ marginBottom: 10 }}>{edition ? `U.S. NEWS ${edition} RANKINGS · ANY U.S. COLLEGE` : "RANKINGS · ANY U.S. COLLEGE"}</div>
          <h1 className="cf-page-title">Explore colleges</h1>
          <p className="cf-page-lede">Browse the national ranking or search any U.S. college. Open a school to see cost, outcomes, and programs, then add it to your shortlist.</p>
        </div>
      </header>

      <div className="cf-explore-toolbar">
        <label className="cf-explore-search">
          <span className="cf-sr-only">Search colleges</span>
          <SearchIcon />
          <input type="search" placeholder="Search any U.S. college, e.g. UCLA" value={q}
            onChange={(e) => { setQ(e.target.value); setSelected(null); }} />
        </label>
        <div className="cf-explore-filters" role="group" aria-label="Filter schools">
          {SETTINGS.map((s) => (
            <button key={s.id} type="button" aria-pressed={setting === s.id} className={"cf-filter-pill cf-press" + (setting === s.id ? " is-active" : "")}
              onClick={() => setSetting(s.id)}>{s.label}</button>
          ))}
          <span className="cf-explore-divider" aria-hidden="true" />
          <button type="button" aria-pressed={favOnly} className={"cf-filter-pill cf-press" + (favOnly ? " is-active" : "")}
            onClick={() => setFavOnly((v) => !v)}>★ Favorites{favorites.length ? ` (${favorites.length})` : ""}</button>
        </div>
      </div>

      {error ? <div className="cf-notice" role="alert">{error}</div> : null}

      <div className="cf-split cf-split--explore">
        <div className="cf-split__list">
          <div className="cf-explore-meta">
            <span role="status">{listLabel}</span>
            {searchMode ? <button type="button" onClick={() => setQ("")}>← Back to ranking</button> : null}
          </div>
          <div className="cf-explore-list" role="list" aria-label="Colleges">
            {browseLoading && !searchMode ? (
              <div className="cf-explore-empty">Loading the U.S. News ranking…</div>
            ) : list.length === 0 ? (
              // The status line already says "Searching…" — don't repeat it here.
              searching ? null : <div className="cf-explore-empty">No schools match these filters.</div>
            ) : list.map((c) => (
              <SchoolRow key={c.slug} c={c} selected={current && current.slug === c.slug}
                favorite={favorites.includes(c.slug)} onToggleFavorite={() => onToggleFavorite(c.slug)}
                onSelect={() => selectSchool(c.slug)} />
            ))}
          </div>
        </div>

        <div className="cf-split__detail">
          {current ? (
            <ExploreDetail key={current.slug} c={current} detail={detail} savedCollege={myList.find((school) => school.slug === current.slug)} loading={detailLoading}
              edition={edition}
              favorite={favorites.includes(current.slug)}
              onToggleFavorite={() => onToggleFavorite(current.slug)}
              onAdd={addCollege} onRemove={removeCollege}
              onList={onListSlugs.has(current.slug)}
              busy={busySlug === current.slug} />
          ) : (
            <div className="cf-explore-placeholder">
              <div><span aria-hidden="true">✱</span>Pick a school from the ranking, or search for any U.S. college.</div>
            </div>
          )}
        </div>
      </div>

      <details className="cf-methodology">
        <summary>About this data</summary>
        <p>Ranks, average GPA, and campus photos come from the {rankingName} list. Admission rates, SAT/ACT ranges, cost, graduation, and earnings come from the U.S. Department of Education’s College Scorecard. A rank is one publication’s judgment, not a measure of fit. Confirm deadlines and requirements with each college.</p>
      </details>
    </div>
  );
}
window.Explore = Explore;
