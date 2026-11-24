// The List tab: every application in one compact list, best average rank first.

function useRankingSchools() {
  const [state, setState] = React.useState({ schools: null, error: false });
  React.useEffect(() => {
    let live = true;
    fetch("/data/career-ranking.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (live) setState({ schools: Array.isArray(j.schools) ? j.schools : [], error: false }); })
      .catch(() => { if (live) setState({ schools: null, error: true }); });
    return () => { live = false; };
  }, []);
  return state;
}

const rankText = (n) => (n == null ? "—" : `#${n}`);

function RankList({ tracker }) {
  const { SchoolMark } = window.cfApp;
  const { Button } = window.CollegeForgeDesignSystem_e95e63;
  const { schools, error } = useRankingSchools();
  const [copied, setCopied] = React.useState("");
  const rows = schools ? window.cfRankList.rankList(tracker.apps, schools) : [];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.cfRankList.copyText(rows));
      setCopied("Copied");
    } catch (e) {
      setCopied("Couldn’t copy");
    }
    setTimeout(() => setCopied(""), 1800);
  };
  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">List</h1>
          <p className="cf-page-lede">Your schools, ordered by the average of their U.S. News, Niche and Forbes ranks. U.S. News ranks liberal arts colleges on a separate list, so those average Niche and Forbes only.</p>
        </div>
        {rows.length ? <div className="cf-row-actions"><Button size="sm" variant="secondary" onClick={copy}>{copied || "Copy colleges"}</Button></div> : null}
      </header>
      {error ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>Couldn’t load the rankings. Reload the page to try again.</p> : null}
      {!tracker.apps.length ? <p className="cf-help">Add schools on <a href="#applications">Portals</a> or <a href="#progress">Progress</a> and they’ll show up here.</p> : null}
      {schools && rows.length ? (
        <ol className="cf-apps-list cf-rank-list">
          {rows.map((r, i) => (
            <li key={r.app.id} className="cf-rank-row">
              <span className="cf-rank-row__pos">{r.avg == null ? "" : i + 1}</span>
              <SchoolMark name={r.app.name} logo={r.app.logo} />
              <span className="cf-rank-row__name">{r.app.name}</span>
              <span className="cf-rank-row__src" title={r.ranks.lac ? "U.S. News (liberal arts list, not averaged) · Niche · Forbes" : "U.S. News · Niche · Forbes"}>{r.avg == null ? "Not ranked" : `${rankText(r.ranks.usn)}${r.ranks.lac ? " LAC" : ""} · ${rankText(r.ranks.niche)} · ${rankText(r.ranks.forbes)}`}</span>
              <span className="cf-rank-row__avg" title="Average rank">{r.avg == null ? "—" : r.avg.toFixed(1)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
window.RankList = RankList;
