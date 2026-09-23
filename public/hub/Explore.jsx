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

function CollegePhoto({ name, photo, className }) {
  const [failed, setFailed] = React.useState(false);
  return (
    <div className={className} aria-hidden="true">
      {photo && !failed ? <img src={photo} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span>{window.collegeInitials(name)}</span>}
    </div>
  );
}
window.CollegePhoto = CollegePhoto;

function CollegeCard({ c, favorite, busy, onOpen, onAdd, onToggleFavorite }) {
  const ranked = typeof c.rank === "number" && c.rank > 0;
  const fit = (c.tags || [])[0];
  return (
    <article className="cf-explore-card">
      <a href={`#explore/${encodeURIComponent(c.slug)}`} className="cf-explore-card__open" onClick={(e) => { e.preventDefault(); onOpen(c); }}>
        <div className="cf-explore-card__media">
          <CollegePhoto name={c.name} photo={c.photo} className="cf-explore-card__photo" />
          {ranked ? <span className="cf-explore-card__rank">#{c.rank}</span> : null}
        </div>
        <div className="cf-explore-card__body">
          <h3>{c.name}</h3>
          <p className="cf-explore-card__place">{c.location || "Location unavailable"}</p>
          <dl className="cf-explore-card__metrics">
            <div><dt>Admit rate</dt><dd>{c.admit || "—"}</dd></div>
            <div><dt>SAT middle 50%</dt><dd>{c.satRange || "—"}</dd></div>
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
  const [setting, setSetting] = React.useState("all");
  const [favOnly, setFavOnly] = React.useState(false);
  const [shown, setShown] = React.useState(PAGE_SIZE);
  // Browse = the U.S. News ranking. Search replaces it when q ≥ 2.
  const [browse, setBrowse] = React.useState(null);
  const [edition, setEdition] = React.useState("");
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
  const list = source
    .filter((c) => (setting === "all" ? true : c.setting === setting))
    .filter((c) => (favOnly ? favorites.includes(c.slug) : true))
    .map((c) => ({ ...c, onList: onListSlugs.has(c.slug) }));

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
      const { onList, programs, ...college } = rich;
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

  const filtered = favOnly || setting !== "all";
  const heading = searching
    ? "Searching…"
    : searchMode
      ? `${list.length} result${list.length === 1 ? "" : "s"} for “${q.trim()}”`
      : browseLoading
        ? "Loading the ranking…"
        : `${list.length} ${filtered ? "matching " : ""}college${list.length === 1 ? "" : "s"}`;
  const filterBy = (fn) => { setShown(PAGE_SIZE); fn(); };

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <div className="cf-eyebrow" style={{ marginBottom: 10 }}>{edition ? `U.S. NEWS ${edition} RANKINGS · ANY U.S. COLLEGE` : "RANKINGS · ANY U.S. COLLEGE"}</div>
          <h1 className="cf-page-title">Explore colleges</h1>
          <p className="cf-page-lede">Browse the national ranking or search any U.S. college. Open a school for cost, outcomes, and programs, and add the ones you like to your shortlist.</p>
        </div>
      </header>

      <div className="cf-explore-toolbar">
        <label className="cf-explore-search">
          <span className="cf-sr-only">Search colleges</span>
          <SearchIcon />
          <input type="search" placeholder="Search any U.S. college, e.g. UCLA" value={q}
            onChange={(e) => { setShown(PAGE_SIZE); setQ(e.target.value); }} />
        </label>
        <div className="cf-explore-filters" role="group" aria-label="Filter colleges">
          {SETTINGS.map((s) => (
            <button key={s.id} type="button" aria-pressed={setting === s.id} className={"cf-filter-pill cf-press" + (setting === s.id ? " is-active" : "")}
              onClick={() => filterBy(() => setSetting(s.id))}>{s.label}</button>
          ))}
          <span className="cf-explore-divider" aria-hidden="true" />
          <button type="button" aria-pressed={favOnly} className={"cf-filter-pill cf-press" + (favOnly ? " is-active" : "")}
            onClick={() => filterBy(() => setFavOnly((v) => !v))}>★ Favorites{favorites.length ? ` (${favorites.length})` : ""}</button>
        </div>
      </div>

      {error ? <div className="cf-notice" role="alert">{error}</div> : null}

      <div className="cf-section-heading">
        <h2 role="status">{heading}</h2>
        {searchMode ? <button type="button" className="cf-explore-link" onClick={() => setQ("")}>← Back to the ranking</button>
          : <span>Ranked by {rankingName}</span>}
      </div>

      {browseLoading && !searchMode ? null : list.length === 0 ? (
        searching ? null : <div className="cf-empty">No colleges match these filters.{favOnly ? " Tap ☆ on a college to save it to your favorites." : ""}</div>
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
        <p>Ranks, average GPA, and campus photos come from the {rankingName} list. Admission rates, SAT/ACT ranges, cost, graduation, and earnings come from the U.S. Department of Education’s College Scorecard. A rank is one publication’s judgment, not a measure of fit. Confirm deadlines and requirements with each college.</p>
      </details>
    </div>
  );
}
window.Explore = Explore;
