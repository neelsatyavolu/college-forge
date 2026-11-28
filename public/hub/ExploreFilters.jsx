// Explore's sort and filters. Rows carry raw numbers in `f` (see lib/explore-catalog.ts);
// a filter only matches rows whose data says so, so a school with no data never passes a filter.

const EXPLORE_SORTS = [
  { id: "rank", label: "Rank" },
  { id: "admit-asc", label: "Most selective" },
  { id: "admit-desc", label: "Highest admit rate" },
  { id: "net-asc", label: "Lowest net price" },
  { id: "earn-desc", label: "Highest earnings" },
  { id: "grad-desc", label: "Highest graduation rate" },
  { id: "size-desc", label: "Largest" },
  { id: "size-asc", label: "Smallest" },
  { id: "name", label: "Name A–Z" },
];

const SELECTS = [
  { key: "type", label: "Type", options: [["all", "Any type"], ["national", "Research universities"], ["liberal-arts", "Liberal arts colleges"], ["other", "Other four-year colleges"]] },
  { key: "control", label: "Public or private", options: [["all", "Public or private"], ["public", "Public"], ["private", "Private"]] },
  // The same regions and names as onboarding's list preferences (lib/college-recommendations.ts REGIONS).
  { key: "region", label: "Region", options: [["all", "Any region"], ["west", "West"], ["midwest", "Midwest"], ["south", "South"], ["mid-atlantic", "Mid-Atlantic"], ["northeast", "New England"]] },
  { key: "size", label: "Size", options: [["all", "Any size"], ["small", "Under 5,000 students"], ["medium", "5,000–15,000"], ["large", "Over 15,000"]] },
  { key: "admit", label: "Admit rate", options: [["all", "Any admit rate"], ["lt15", "Under 15%"], ["15-40", "15–40%"], ["40-70", "40–70%"], ["gt70", "Over 70%"]] },
  { key: "net", label: "Net price", options: [["all", "Any net price"], ["lt15", "Under $15,000"], ["lt25", "Under $25,000"], ["lt35", "Under $35,000"]] },
];

const TOGGLES = [
  { key: "meetsNeed", label: "Meets full need" },
  { key: "testOptional", label: "Test-optional" },
  { key: "intlAid", label: "Aids international students" },
  { key: "nursing", label: "Direct-entry nursing" },
  { key: "ed", label: "Early Decision" },
  { key: "ea", label: "Early Action" },
  { key: "inRange", label: "In my SAT range" },
  { key: "hbcu", label: "HBCU" },
  { key: "women", label: "Women’s college" },
  { key: "notes", label: "Has Forge notes" },
];

// States per region, as in lib/college-recommendations.ts REGIONS; change both together.
const REGION_STATES = {
  northeast: ["ME", "NH", "VT", "MA", "RI", "CT"],
  "mid-atlantic": ["NY", "NJ", "PA", "DE", "MD", "DC"],
  south: ["VA", "WV", "KY", "TN", "NC", "SC", "GA", "FL", "AL", "MS", "LA", "AR", "OK", "TX"],
  midwest: ["OH", "IN", "IL", "MI", "WI", "MN", "IA", "MO", "ND", "SD", "NE", "KS"],
  west: ["MT", "WY", "CO", "NM", "ID", "UT", "AZ", "NV", "WA", "OR", "CA", "AK", "HI"],
};

const DEFAULT_FILTERS = { sort: "rank", setting: "all", type: "all", control: "all", region: "all", state: "", size: "all", admit: "all", net: "all", on: [] };
const FILTER_STORE = "cf-explore-filters";

function loadExploreFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_STORE) || "null");
    if (!saved || typeof saved !== "object") return DEFAULT_FILTERS;
    // A saved "favorites" toggle (Explore no longer has favorites) is dropped; so is an unknown region.
    const on = Array.isArray(saved.on) ? saved.on.filter((k) => TOGGLES.some((t) => t.key === k)) : [];
    const region = REGION_STATES[saved.region] ? saved.region : "all";
    return { ...DEFAULT_FILTERS, ...saved, on, region };
  } catch { return DEFAULT_FILTERS; }
}
function saveExploreFilters(f) {
  try { localStorage.setItem(FILTER_STORE, JSON.stringify(f)); } catch { /* private mode */ }
}

const kindOf = (c) => (c.lacRank || c.f?.kind === "liberal-arts" ? "liberal-arts" : c.rank || c.f?.kind === "research" ? "national" : "other");

const BANDS = {
  size: { small: [0, 5000], medium: [5000, 15000], large: [15000, Infinity] },
  admit: { lt15: [0, 0.15], "15-40": [0.15, 0.4], "40-70": [0.4, 0.7], gt70: [0.7, 1.01] },
  net: { lt15: [0, 15000], lt25: [0, 25000], lt35: [0, 35000] },
};
const inBand = (v, band) => typeof v === "number" && v >= band[0] && v < band[1];

const TOGGLE_TEST = {
  meetsNeed: (f) => f.meetsNeed === true,
  testOptional: (f) => f.testPolicy === "optional" || f.testPolicy === "blind",
  intlAid: (f) => f.intl === "aid",
  nursing: (f) => f.nursing === "direct" || f.nursing === "both",
  ed: (f) => f.ed === true,
  ea: (f) => f.ea === true,
  hbcu: (f) => f.hbcu === true,
  women: (f) => f.women === true,
  notes: (f) => f.notes === true,
};

function matchesExplore(c, filters, ctx) {
  const f = c.f || {};
  if (filters.setting !== "all" && c.setting !== filters.setting) return false;
  if (filters.type !== "all" && kindOf(c) !== filters.type) return false;
  if (filters.control !== "all" && f.control !== filters.control) return false;
  if (filters.region !== "all" && !(REGION_STATES[filters.region] || []).includes(f.state)) return false;
  if (filters.state && f.state !== filters.state) return false;
  for (const key of ["size", "admit", "net"]) {
    if (filters[key] !== "all" && !inBand(f[key], BANDS[key][filters[key]])) return false;
  }
  for (const key of filters.on) {
    if (key === "inRange") { if (!(c.tags || []).some((t) => t.tone === "close" || t.tone === "strong")) return false; continue; }
    if (TOGGLE_TEST[key] && !TOGGLE_TEST[key](f)) return false;
  }
  return true;
}

// Ranked schools first (national and liberal arts ranks side by side), then the rest by size.
const rankKey = (c) => Math.min(c.rank || Infinity, c.lacRank ? c.lacRank + 0.5 : Infinity);
const byNum = (get, dir) => (a, b) => {
  const x = get(a), y = get(b);
  const ax = typeof x === "number", by = typeof y === "number";
  if (ax !== by) return ax ? -1 : 1; // unknowns last, whichever direction
  return ax ? (x - y) * dir : 0;
};
const SORT_FNS = {
  rank: (a, b) => rankKey(a) - rankKey(b) || (b.f?.size || 0) - (a.f?.size || 0),
  "admit-asc": byNum((c) => c.f?.admit, 1),
  "admit-desc": byNum((c) => c.f?.admit, -1),
  "net-asc": byNum((c) => c.f?.net, 1),
  "earn-desc": byNum((c) => c.f?.earn, -1),
  "grad-desc": byNum((c) => c.f?.grad, -1),
  "size-desc": byNum((c) => c.f?.size, -1),
  "size-asc": byNum((c) => c.f?.size, 1),
  name: (a, b) => a.name.localeCompare(b.name),
};

/** Filtered and sorted copy of `list`. Search results keep their relevance order unless a sort is picked. */
function applyExploreFilters(list, filters, ctx) {
  const kept = list.filter((c) => matchesExplore(c, filters, ctx));
  if (ctx.searchMode && filters.sort === "rank") return kept;
  const fn = SORT_FNS[filters.sort] || SORT_FNS.rank;
  // Liberal arts colleges sort by their own list when that is the type shown.
  const rankFn = filters.type === "liberal-arts" && filters.sort === "rank"
    ? (a, b) => (a.lacRank || Infinity) - (b.lacRank || Infinity) || (b.f?.size || 0) - (a.f?.size || 0)
    : fn;
  return [...kept].sort(rankFn);
}

function activeFilterCount(filters) {
  return ["type", "control", "region", "size", "admit", "net"].filter((k) => filters[k] !== "all").length
    + (filters.state ? 1 : 0) + filters.on.length;
}

/** Chips for the active filters, each removable. */
function activeFilterChips(filters) {
  const chips = [];
  for (const s of SELECTS) {
    if (filters[s.key] !== "all") chips.push({ id: s.key, label: s.options.find(([v]) => v === filters[s.key])?.[1] || filters[s.key], clear: { [s.key]: "all" } });
  }
  if (filters.state) chips.push({ id: "state", label: filters.state, clear: { state: "" } });
  for (const t of TOGGLES) {
    if (filters.on.includes(t.key)) chips.push({ id: t.key, label: t.label, clear: { on: filters.on.filter((k) => k !== t.key) } });
  }
  return chips;
}

function ExploreFilterPanel({ filters, states, onChange, onClear }) {
  const toggle = (key) => onChange({ on: filters.on.includes(key) ? filters.on.filter((k) => k !== key) : [...filters.on, key] });
  return (
    <div className="cf-explore-panel" id="cf-explore-panel">
      <div className="cf-explore-panel__selects">
        {SELECTS.map((s) => (
          <label key={s.key} className="cf-explore-select">
            <span>{s.label}</span>
            <select value={filters[s.key]} onChange={(e) => onChange({ [s.key]: e.target.value })}>
              {s.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        ))}
        <label className="cf-explore-select">
          <span>State</span>
          <select value={filters.state} onChange={(e) => onChange({ state: e.target.value })}>
            <option value="">Any state</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="cf-explore-panel__toggles" role="group" aria-label="Only show colleges that">
        {TOGGLES.map((t) => (
          <button key={t.key} type="button" aria-pressed={filters.on.includes(t.key)}
            className={"cf-filter-pill cf-press" + (filters.on.includes(t.key) ? " is-active" : "")}
            onClick={() => toggle(t.key)}>{t.label}</button>
        ))}
      </div>
      <p className="cf-explore-panel__note">
        Full need, rounds and testing come from Forge’s sourced notes on about 150 colleges, plus federal data for testing elsewhere. A school without that data won’t match those filters. <button type="button" className="cf-explore-link" onClick={onClear}>Clear all filters</button>
      </p>
    </div>
  );
}

Object.assign(window, {
  EXPLORE_SORTS, DEFAULT_FILTERS, loadExploreFilters, saveExploreFilters, applyExploreFilters,
  activeFilterCount, activeFilterChips, ExploreFilterPanel,
});
