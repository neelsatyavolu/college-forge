// The Official rankings tab: the Forge ranking (a weighted average of the others),
// then U.S. News, liberal arts, Forbes, Niche, WSJ and Princeton Review lists as
// published, each school expandable to its facts and its ranks on the other lists.

const OFFICIAL_LISTS = [
  { id: "forge", label: "Forge", title: "Forge ranking", top: 100 },
  { id: "usn", label: "U.S. News", title: "U.S. News National Universities", top: 100 },
  { id: "lac", label: "Liberal arts", title: "U.S. News National Liberal Arts Colleges", top: 50 },
  { id: "forbes", label: "Forbes", title: "Forbes America’s Top Colleges", top: 100 },
  { id: "niche", label: "Niche", title: "Niche Best Colleges in America", top: 100 },
  { id: "wsj", label: "WSJ", title: "WSJ/College Pulse Best Colleges in the U.S.", top: 100 },
  { id: "prPublic", label: "Best value public", title: "Princeton Review Top 50 Best Value Colleges (Public)", top: 50 },
  { id: "prPrivate", label: "Best value private", title: "Princeton Review Top 50 Best Value Colleges (Private)", top: 50 },
];
const OTHER_LABEL = {
  usn: "U.S. News", lac: "U.S. News liberal arts", forbes: "Forbes", niche: "Niche", wsj: "WSJ",
  prPublic: "Princeton Review Best Value (public)", prPrivate: "Princeton Review Best Value (private)",
};
// The editions object names the Princeton Review once and the liberal arts list under U.S. News.
const EDITION_KEY = { lac: "usn", prPublic: "pr", prPrivate: "pr" };
const OFFICIAL_TAB_KEY = "cf.officialRankings.list";

function useOfficialRankings() {
  const [state, setState] = React.useState({ data: null, error: false });
  React.useEffect(() => {
    let live = true;
    fetch("/data/official-rankings.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (live) setState({ data: j && j.lists ? j : null, error: !(j && j.lists) }); })
      .catch(() => { if (live) setState({ data: null, error: true }); });
    return () => { live = false; };
  }, []);
  return state;
}

const fmtMoney = (n) => (n == null ? null : "$" + Math.round(n).toLocaleString("en-US"));
const fmtCount = (n) => (n == null ? null : Math.round(n).toLocaleString("en-US"));

function OfficialFacts({ row, listId }) {
  const f = row.facts || {};
  const facts = [
    ["Admit rate", f.admitRate == null ? null : `${f.admitRate}%`],
    ["SAT middle 50%", f.sat],
    ["Sticker cost / yr", fmtMoney(f.cost)],
    ["Median salary (Forbes)", fmtMoney(f.salary)],
    ["Undergraduates", fmtCount(f.undergrads)],
    ["Setting", f.setting],
  ];
  if (listId === "niche" && row.reviews) facts.push(["Niche reviews", row.stars ? `${row.stars} ★ from ${fmtCount(row.reviews)}` : fmtCount(row.reviews)]);
  if (listId === "forge" && row.avg != null) facts.unshift(["Weighted average rank", row.avg.toFixed(1)]);
  const shown = facts.filter(([, v]) => v);
  const others = Object.entries(row.elsewhere || {});
  return (
    <div className="cf-orank__details">
      {shown.length ? (
        <dl className="cf-orank__facts">
          {shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      ) : <p className="cf-help">No admissions or cost figures on file for this school.</p>}
      <p className="cf-orank__others">
        {others.length
          ? <React.Fragment>Also ranked: {others.map(([id, r], i) => <span key={id}>{i ? " · " : ""}{OTHER_LABEL[id]} <b>#{r}</b></span>)}</React.Fragment>
          : "Not on the other lists here."}
        {f.website ? <React.Fragment>{" · "}<a href={"https://" + f.website} target="_blank" rel="noopener noreferrer">{f.website.replace(/^www\./, "")}</a></React.Fragment> : null}
      </p>
    </div>
  );
}

function OfficialRankings() {
  const { SchoolMark } = window.cfApp;
  const { data, error } = useOfficialRankings();
  const [listId, setListId] = React.useState(() => {
    try { const v = localStorage.getItem(OFFICIAL_TAB_KEY); return OFFICIAL_LISTS.some((l) => l.id === v) ? v : "forge"; } catch (e) { return "forge"; }
  });
  const [open, setOpen] = React.useState(null);
  const pick = (id) => { setListId(id); setOpen(null); try { localStorage.setItem(OFFICIAL_TAB_KEY, id); } catch (e) {} };
  const list = OFFICIAL_LISTS.find((l) => l.id === listId);
  const rows = data ? data.lists[listId] || [] : [];
  const edition = data && data.editions ? data.editions[EDITION_KEY[listId] || listId] : "";

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Official rankings</h1>
          <p className="cf-page-lede">The published lists, in the publishers’ own order, and the Forge ranking: a weighted average of them, the same one your List tab uses. Open a school for its admit rate, test scores, cost and where it lands on the other lists.</p>
        </div>
      </header>
      {error ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>Couldn’t load the rankings. Reload the page to try again.</p> : null}
      <div className="cf-ptabs cf-ptabs--scroll" role="tablist" aria-label="Ranking lists">
        {OFFICIAL_LISTS.map((l) => (
          <button key={l.id} type="button" role="tab" id={`orank-tab-${l.id}`} aria-selected={listId === l.id} aria-controls="orank-panel" className={"cf-ptab" + (listId === l.id ? " is-active" : "")} onClick={() => pick(l.id)}>
            {l.label}<span className="cf-ptab__n">{l.top}</span>
          </button>
        ))}
      </div>
      {data ? (
        <section id="orank-panel" role="tabpanel" aria-labelledby={`orank-tab-${listId}`}>
          <p className="cf-orank__source">{list.title}{edition && listId !== "forge" ? `, ${edition}` : ""} · top {list.top}{rows.length > list.top ? ` (${rows.length} with ties)` : ""}</p>
          {listId === "forge" ? <p className="cf-help cf-orank__about">Each school’s ranks averaged with fixed weights: U.S. News and Forbes count fully, Niche ¾, WSJ ½ and the Princeton Review ¼. Liberal arts and Princeton Review ranks count at the national rank of the same standing. A school needs U.S. News plus Niche’s worth of weight or more to be ranked, so one list alone can’t place it.</p> : null}
          <ol className="cf-apps-list cf-orank">
            {rows.map((r) => {
              const key = `${listId}-${r.rank}-${r.name}`;
              const isOpen = open === key;
              return (
                <li key={key} className={"cf-orank__item" + (isOpen ? " is-open" : "")}>
                  <button type="button" className="cf-orank__row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                    <span className="cf-orank__pos">{r.rank}</span>
                    <SchoolMark name={r.name} logo={r.logo} />
                    <span className="cf-orank__name">{r.name}</span>
                    <span className="cf-orank__place">{[r.city, r.state].filter(Boolean).join(", ")}</span>
                    <svg className="cf-orank__chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  {isOpen ? <OfficialFacts row={r} listId={listId} /> : null}
                </li>
              );
            })}
          </ol>
          <p className="cf-help cf-orank__foot">Ranks are copied from each publisher. Admit rate and SAT come from U.S. News and the College Scorecard where we have them, otherwise Forbes; setting from U.S. News; cost, salary and size from Forbes.</p>
        </section>
      ) : null}
    </div>
  );
}
window.OfficialRankings = OfficialRankings;
