const { CollegeCard, Chip } = window.CollegeForgeDesignSystem_e95e63;

const SETTINGS = [
  { id: "all", label: "All" },
  { id: "urban", label: "Urban" },
  { id: "suburban", label: "Suburban" },
  { id: "town", label: "Town" },
  { id: "rural", label: "Rural" },
];

// Missing Scorecard fields render as em dash — never a raw 0/empty string.
const dash = (v) =>
  v === undefined || v === null || v === ""
    ? "—"
    : v;

function Explore({ data, favorites, onToggleFavorite, onWorkspaceChange }) {
  const [q, setQ] = React.useState("");
  const [setting, setSetting] = React.useState("all");
  const [favOnly, setFavOnly] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  // Browse = US News top ~250. Search replaces this when q ≥ 2.
  const [browse, setBrowse] = React.useState(null); // null = loading browse
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

  const listLabel = searching
    ? "Searching…"
    : searchMode
      ? `${list.length} result${list.length === 1 ? "" : "s"}`
      : browseLoading
        ? "Loading top schools…"
        : `US News top 250 — ${list.length} school${list.length === 1 ? "" : "s"}`;

  return (
    <div className="cf-page">
      <style>{`@media (max-width: 960px) { .cf-split--explore .cf-split__list { width: 100%; max-width: none; } }`}</style>
      <header className="cf-page-header" style={{ borderBottom: "none", paddingBottom: 0, marginBottom: 16 }}>
        <div>
          <h1 className="cf-page-title">Explore colleges</h1>
          <p className="cf-page-lede">
            Browse the U.S. News National Universities top 250, or search any U.S. college. Admit rates, SAT/ACT,
            net price, graduation rate, and earnings come from the College Scorecard. Ranks and campus photos are
            from U.S. News 2026. Add schools to your list to compare them. Confirm application details with each college.
          </p>
        </div>
      </header>

      <div className="cf-split cf-split--explore">
        {/* Left: search + list */}
        <div className="cf-split__list">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>Search colleges
              <input type="search" placeholder="College name, e.g. UCLA" value={q}
                style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: "10px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)", font: "inherit", fontSize: 14 }}
                onChange={(e) => { setQ(e.target.value); setSelected(null); }} />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {SETTINGS.map((s) => (
                <Chip key={s.id} active={setting === s.id} onClick={() => setSetting(s.id)}>{s.label}</Chip>
              ))}
              <span aria-hidden style={{ width: 1, height: 16, background: "var(--hairline)" }} />
              <Chip active={favOnly} onClick={() => setFavOnly((v) => !v)}>★ Favorites{favorites.length ? ` (${favorites.length})` : ""}</Chip>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "12px 0" }}>
            <p className="cf-nums" style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>{listLabel}</p>
            {searchMode ? (
              <button type="button" onClick={() => setQ("")} className="cf-press"
                style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "var(--coral)", minHeight: 32, padding: "4px 6px" }}>
                Back to top 250
              </button>
            ) : null}
          </div>

          {error ? (
            <div role="alert" style={{ marginBottom: 8, borderRadius: "var(--radius-sm)", border: "1px solid var(--error)", background: "color-mix(in srgb, var(--error) 8%, transparent)", padding: "8px 10px", fontSize: 12.5, color: "var(--error)" }}>{error}</div>
          ) : null}

          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4, minHeight: 0 }}>
            {browseLoading && !searchMode ? (
              <div style={{ fontSize: 14, color: "var(--muted)", fontStyle: "italic", padding: "8px 0" }}>Loading U.S. News top 250…</div>
            ) : list.length === 0 ? (
              // Status line already shows "Searching…" — don't repeat it here.
              searching ? null : (
                <div style={{ fontSize: 14, color: "var(--muted)", fontStyle: "italic", padding: "8px 0" }}>
                  No schools match these filters.
                </div>
              )
            ) : list.map((c) => (
              <CollegeCard key={c.slug} name={c.name} location={c.location} rank={c.rank}
                admit={dash(c.admit)} satRange={dash(c.satRange)} gpa={dash(c.gpa)} photo={c.photo} tags={c.tags}
                favorite={favorites.includes(c.slug)} selected={current && current.slug === c.slug}
                onToggleFavorite={() => onToggleFavorite(c.slug)} onSelect={() => {
                  setSelected(c.slug);
                  if (window.matchMedia("(max-width: 960px)").matches) document.querySelector(".cf-split__detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }} />
            ))}
          </div>
        </div>

        {/* Right: detail — takes remaining width */}
        <div className="cf-split__detail">
          {current ? (
            <ExploreDetail key={current.slug} c={current} detail={detail} savedCollege={myList.find((school) => school.slug === current.slug)} loading={detailLoading}
              favorite={favorites.includes(current.slug)}
              onToggleFavorite={() => onToggleFavorite(current.slug)}
              onAdd={addCollege} onRemove={removeCollege}
              onList={onListSlugs.has(current.slug)}
              busy={busySlug === current.slug} />
          ) : (
            <div style={{ height: "100%", minHeight: 280, display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
              <div style={{ maxWidth: 320 }}>
                <div aria-hidden style={{ color: "var(--coral)", fontSize: 28, lineHeight: 1, marginBottom: 10 }}>✱</div>
                <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, textWrap: "pretty" }}>
                  Select a school from the U.S. News top 250, or search for any U.S. college.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
window.Explore = Explore;
