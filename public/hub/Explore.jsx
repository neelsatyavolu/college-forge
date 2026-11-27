const { Button } = window.CollegeForgeDesignSystem_e95e63;

const SETTINGS = [
  { id: "all", label: "All" },
  { id: "urban", label: "Urban" },
  { id: "suburban", label: "Suburban" },
  { id: "town", label: "Town" },
  { id: "rural", label: "Rural" },
];
const PAGE_SIZE = 24;

// "#explore/<slug>" is an open school; plain "#explore" is the grid.
function slugFromHash() {
  const [view, slug] = window.location.hash.slice(1).split("/");
  return view === "explore" && slug ? decodeURIComponent(slug) : null;
}

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);

// A soft tint per school so photo-less cards don't all look alike.
function tintFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function CollegePhoto({ name, photo, thumb, className, eager }) {
  const [failed, setFailed] = React.useState(false);
  const src = thumb || photo;
  const has = src && !failed;
  return (
    <div className={className + (has ? "" : " is-empty")} aria-hidden="true" style={has ? null : { "--tint": tintFor(name) }}>
      {has ? (
        <img src={src} srcSet={thumb && photo && thumb !== photo ? `${thumb} 500w, ${photo} 1280w` : undefined}
          sizes={thumb ? "(max-width: 600px) 100vw, 340px" : undefined}
          alt="" loading={eager ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : <span>{window.collegeInitials(name)}</span>}
    </div>
  );
}
window.CollegePhoto = CollegePhoto;

const money = (n) => (typeof n !== "number" ? "—" : n < 1000 ? `$${Math.round(n)}` : `$${Math.round(n / 1000)}k`);

/** Up to two of the facts students filter on most, shown under the school's place. */
function cardHighlights(c) {
  const f = c.f || {};
  return [
    f.meetsNeed ? "Meets full need" : null,
    f.testPolicy === "optional" ? "Test-optional" : f.testPolicy === "blind" ? "Test-blind" : f.testPolicy === "required" ? "Tests required" : null,
    f.hbcu ? "HBCU" : null,
    f.women ? "Women’s college" : null,
    f.nursing === "direct" ? "Direct-entry nursing" : null,
  ].filter(Boolean).slice(0, 2);
}

function rankLabel(c) {
  if (typeof c.rank === "number" && c.rank > 0) return `#${c.rank}`;
  if (typeof c.lacRank === "number" && c.lacRank > 0) return `#${c.lacRank} Liberal arts`;
  return null;
}

function CollegeCard({ c, favorite, busy, onOpen, onAdd, onToggleFavorite }) {
  const rank = rankLabel(c);
  const fit = (c.tags || [])[0];
  const f = c.f || {};
  const type = [f.control === "public" ? "Public" : f.control === "private" ? "Private" : null,
    f.kind === "liberal-arts" || c.lacRank ? "liberal arts" : f.kind === "research" ? "research university" : null].filter(Boolean).join(" ");
  const highlights = cardHighlights(c);
  return (
    <article className="cf-explore-card">
      <a href={`#explore/${encodeURIComponent(c.slug)}`} className="cf-explore-card__open" onClick={(e) => { e.preventDefault(); onOpen(c); }}>
        <div className="cf-explore-card__media">
          <CollegePhoto name={c.name} photo={c.photo} thumb={c.thumb} className="cf-explore-card__photo" />
          {rank ? <span className="cf-explore-card__rank">{rank}</span> : null}
        </div>
        <div className="cf-explore-card__body">
          <h3>{c.name}</h3>
          <p className="cf-explore-card__place">{[c.location || "Location unavailable", type ? type[0].toUpperCase() + type.slice(1) : null].filter(Boolean).join(" · ")}</p>
          {highlights.length ? (
            <ul className="cf-explore-card__tags">{highlights.map((h) => <li key={h}>{h}</li>)}</ul>
          ) : null}
          <dl className="cf-explore-card__metrics">
            <div><dt>Admit rate</dt><dd>{c.admit || "—"}</dd></div>
            <div><dt>SAT mid 50%</dt><dd>{c.satRange || "—"}</dd></div>
            <div><dt>Net price</dt><dd>{money(f.net)}</dd></div>
          </dl>
        </div>
      </a>
      <div className="cf-explore-card__actions">
        {c.onList ? <span className="cf-tier-label">On your shortlist ✓</span>
          : <button type="button" className="cf-explore-card__add" disabled={busy} onClick={() => onAdd(c)}>{busy ? "Saving…" : "+ Add to shortlist"}</button>}
        {fit ? <span className="cf-explore-card__fit">{fit.label}</span> : null}
        <button type="button" className="cf-explore-fav cf-press" aria-pressed={favorite} aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${c.name}`} onClick={onToggleFavorite}>
          {favorite ? "★" : "☆"}
        </button>
      </div>
    </article>
  );
}

function Explore({ data, favorites, onToggleFavorite, onWorkspaceChange }) {
  const [q, setQ] = React.useState("");
  const [filters, setFilters] = React.useState(window.loadExploreFilters);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [shown, setShown] = React.useState(PAGE_SIZE);
  // Browse = the U.S. News ranking. Search replaces it when q ≥ 2.
  const [browse, setBrowse] = React.useState(null);
  const [edition, setEdition] = React.useState("");
  const [catalogDate, setCatalogDate] = React.useState("");
  const [results, setResults] = React.useState(null);
  const [searching, setSearching] = React.useState(false);
  const [browseLoading, setBrowseLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [busySlug, setBusySlug] = React.useState(null);
  const [openSlug, setOpenSlug] = React.useState(slugFromHash);
  const [openRow, setOpenRow] = React.useState(null); // the clicked row, so search results still resolve
  const [detail, setDetail] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const gridScroll = React.useRef(0);

  const myList = data.colleges;
  const searchMode = q.trim().length >= 2;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/colleges/search?browse=1", { credentials: "same-origin" });
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || !j.success) throw new Error(j.error || `Could not load the ranking (${res.status}).`);
        setBrowse(j.data || []);
        setEdition(j.edition || "");
        setCatalogDate(j.catalogDate || "");
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

  React.useEffect(() => {
    const onHash = () => setOpenSlug(slugFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Opening a school starts at the top; closing returns to the same spot in the grid.
  React.useEffect(() => {
    if (openSlug) { window.scrollTo(0, 0); return; }
    const y = gridScroll.current;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [openSlug]);

  const onListSlugs = new Set(myList.map((c) => c.slug));
  const source = searchMode ? (results || []) : (browse || []);
  const favOnly = filters.on.includes("favorites");
  const list = React.useMemo(
    () => window.applyExploreFilters(source, filters, { favorites, searchMode })
      .map((c) => ({ ...c, onList: onListSlugs.has(c.slug) })),
    [source, filters, favorites, searchMode, myList]
  );
  const states = React.useMemo(
    () => [...new Set((browse || []).map((c) => c.f?.state).filter(Boolean))].sort(),
    [browse]
  );
  const updateFilters = (patch) => {
    setShown(PAGE_SIZE);
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      window.saveExploreFilters(next);
      return next;
    });
  };
  const clearFilters = () => updateFilters({ ...window.DEFAULT_FILTERS, sort: filters.sort });

  const current = openSlug
    ? [openRow, ...source, ...(browse || [])].find((c) => c && c.slug === openSlug) || null
    : null;
  const currentId = current ? current.scorecardId : null;

  // Full per-school record (programs, tuition, retention…), keyed by Scorecard id.
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
        if (!res.ok || !j.success) throw new Error(j.error || `Could not load this school (${res.status}).`);
        const d = j.data || {};
        setDetail({ ...d, photo: d.photo || current.photo || null, rank: d.rank ?? current.rank });
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setDetailLoading(false);
    })();
    return () => { cancelled = true; };
  }, [currentId]);

  const open = (c) => {
    gridScroll.current = window.scrollY;
    setOpenRow(c);
    setError("");
    window.location.hash = `explore/${encodeURIComponent(c.slug)}`;
  };

  const addCollege = async (c) => {
    setBusySlug(c.slug); setError("");
    try {
      // Save the full record when it is loaded, minus the bulky programs list
      // (re-fetched from Scorecard on demand).
      const rich = detail && detail.slug === c.slug ? detail : c;
      const { onList, programs, f, research, rankings, niche, switching, earningsRange, intlAid, nursing, credit, thumb, partial, kind, region, hbcu, women, lacRank, ...college } = rich;
      const res = await fetch("/api/workspace/colleges", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ college }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Could not add this school.");
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
      if (!res.ok || !j.success) throw new Error(j.error || "Could not remove this school.");
      if (onWorkspaceChange) await onWorkspaceChange();
    } catch (e) { setError(e.message); }
    setBusySlug(null);
  };

  const rankingName = `U.S. News ${edition ? edition + " " : ""}National Universities`;

  if (openSlug) {
    return (
      <div className="cf-page">
        <a href="#explore" className="cf-explore-back">← All colleges</a>
        {error ? <div className="cf-notice" role="alert">{error}</div> : null}
        {current ? (
          <ExploreDetail key={current.slug} c={current} detail={detail} loading={detailLoading} edition={edition}
            savedCollege={myList.find((school) => school.slug === current.slug)}
            favorite={favorites.includes(current.slug)} onToggleFavorite={() => onToggleFavorite(current.slug)}
            onAdd={addCollege} onRemove={removeCollege} onList={onListSlugs.has(current.slug)}
            busy={busySlug === current.slug} />
        ) : browseLoading ? (
          <div className="cf-notice" role="status">Loading this school…</div>
        ) : (
          <div className="cf-empty">We couldn’t find that school. <a href="#explore">Browse all colleges →</a></div>
        )}
      </div>
    );
  }

  const moreCount = window.activeFilterCount(filters);
  const filtered = moreCount > 0 || favOnly || filters.setting !== "all";
  const chips = window.activeFilterChips(filters);
  const total = (browse || []).length;
  const heading = searching
    ? "Searching…"
    : searchMode
      ? `${list.length} result${list.length === 1 ? "" : "s"} for “${q.trim()}”`
      : browseLoading
        ? "Loading colleges…"
        : `${list.length.toLocaleString()} ${filtered ? "matching " : ""}college${list.length === 1 ? "" : "s"}`;
  const toggleFav = () => updateFilters({ on: favOnly ? filters.on.filter((k) => k !== "favorites") : [...filters.on, "favorites"] });
  const sortLabel = (window.EXPLORE_SORTS.find((x) => x.id === filters.sort) || {}).label;

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <div className="cf-eyebrow" style={{ marginBottom: 10 }}>{total ? `${total.toLocaleString()} COLLEGES · SEARCH ANY U.S. COLLEGE` : "SEARCH ANY U.S. COLLEGE"}</div>
          <h1 className="cf-page-title">Explore colleges</h1>
          <p className="cf-page-lede">Every four-year public and nonprofit college with at least 1,000 undergraduates, plus every ranked school. Filter by cost, aid, testing and admission rounds, then open a school for its costs, outcomes, programs and Forge’s sourced notes.</p>
        </div>
      </header>

      <div className="cf-explore-toolbar">
        <label className="cf-explore-search">
          <span className="cf-sr-only">Search colleges</span>
          <SearchIcon />
          <input type="search" placeholder="Search any U.S. college, city or state" value={q}
            onChange={(e) => { setShown(PAGE_SIZE); setQ(e.target.value); }} />
        </label>
        <label className="cf-explore-sort">
          <span>Sort</span>
          <select value={filters.sort} onChange={(e) => updateFilters({ sort: e.target.value })}>
            {window.EXPLORE_SORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        <button type="button" className={"cf-explore-more-btn cf-press" + (panelOpen || moreCount ? " is-active" : "")}
          aria-expanded={panelOpen} aria-controls="cf-explore-panel" onClick={() => setPanelOpen((v) => !v)}>
          Filters{moreCount ? ` · ${moreCount}` : ""}
        </button>
      </div>

      <div className="cf-explore-filters" role="group" aria-label="Campus setting">
        {SETTINGS.map((x) => (
          <button key={x.id} type="button" aria-pressed={filters.setting === x.id} className={"cf-filter-pill cf-press" + (filters.setting === x.id ? " is-active" : "")}
            onClick={() => updateFilters({ setting: x.id })}>{x.label}</button>
        ))}
        <span className="cf-explore-divider" aria-hidden="true" />
        <button type="button" aria-pressed={favOnly} className={"cf-filter-pill cf-press" + (favOnly ? " is-active" : "")}
          onClick={toggleFav}>★ Favorites{favorites.length ? ` (${favorites.length})` : ""}</button>
      </div>

      {panelOpen ? <window.ExploreFilterPanel filters={filters} states={states} onChange={updateFilters} onClear={clearFilters} /> : null}

      {chips.length ? (
        <div className="cf-explore-chips" aria-label="Active filters">
          {chips.map((ch) => (
            <button key={ch.id} type="button" className="cf-explore-chip cf-press" onClick={() => updateFilters(ch.clear)} aria-label={`Remove filter: ${ch.label}`}>
              {ch.label} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className="cf-explore-link" onClick={clearFilters}>Clear all</button>
        </div>
      ) : null}

      {error ? <div className="cf-notice" role="alert">{error}</div> : null}

      <div className="cf-section-heading">
        <h2 role="status">{heading}</h2>
        {searchMode ? <button type="button" className="cf-explore-link" onClick={() => setQ("")}>← Back to all colleges</button>
          : <span>{filters.sort === "rank" ? `Ranked by ${rankingName}, then by size` : `Sorted by ${String(sortLabel).toLowerCase()}`}</span>}
      </div>

      {browseLoading && !searchMode ? null : list.length === 0 ? (
        searching ? null : (
          <div className="cf-empty">
            No colleges match these filters.{favOnly ? " Tap ☆ on a college to save it to your favorites." : ""}{" "}
            {filtered ? <button type="button" className="cf-explore-link" onClick={clearFilters}>Clear filters</button> : null}
          </div>
        )
      ) : (
        <React.Fragment>
          <div className="cf-explore-grid">
            {list.slice(0, shown).map((c) => (
              <CollegeCard key={c.slug} c={c} favorite={favorites.includes(c.slug)} busy={busySlug === c.slug}
                onOpen={open} onAdd={addCollege} onToggleFavorite={() => onToggleFavorite(c.slug)} />
            ))}
          </div>
          {list.length > shown ? (
            <div className="cf-explore-more">
              <Button variant="secondary" onClick={() => setShown((n) => n + PAGE_SIZE)}>Show more colleges</Button>
              <span>Showing {shown} of {list.length}</span>
            </div>
          ) : null}
        </React.Fragment>
      )}

      <details className="cf-methodology">
        <summary>About this data</summary>
        <p>The list covers every operating four-year public and nonprofit college with at least 1,000 undergraduates in the U.S. Department of Education’s College Scorecard{catalogDate ? ` (as of ${catalogDate})` : ""}, plus every school on the {rankingName} and Liberal Arts lists. Ranks and average GPA come from U.S. News. Admission rates, SAT/ACT ranges, cost, graduation and earnings come from the College Scorecard. Full-need aid, admission rounds and testing policies come from Forge’s notes, sourced from each college’s own pages and Common Data Set. Campus photos are from Wikimedia Commons, credited on each school’s page, or from U.S. News. A rank is one publication’s judgment, not a measure of fit. Confirm deadlines and requirements with each college.</p>
      </details>
    </div>
  );
}
window.Explore = Explore;
