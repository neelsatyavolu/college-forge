// The List tab: every application in one compact list, best average rank first.

function useRankingSchools() {
  const [state, setState] = React.useState({ schools: null, official: [], extra: null, career: null, error: false });
  React.useEffect(() => {
    let live = true;
    const load = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    // The official lists only fill in schools the career file doesn't cover, so the list still shows without them.
    // They also hold the WSJ and Princeton Review lists the average adds.
    const official = load("/data/official-rankings.json").catch(() => null);
    Promise.all([load("/data/career-ranking.json"), official])
      .then(([j, o]) => {
        if (live) setState((s) => ({ ...s, schools: Array.isArray(j.schools) ? j.schools : [], official: o ? window.cfRankList.officialSchools(o) : [], extra: (o && o.extra) || null, error: false }));
      })
      .catch(() => { if (live) setState((s) => ({ ...s, schools: null, official: [], extra: null, error: true })); });
    // The student's own career ranking (My path, with the majors and weights saved on the Career rankings page)
    // joins the average when it arrives; until then, or without it, the list averages the published rankings.
    fetch("/api/rankings/path", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j && Array.isArray(j.ranks)) setState((s) => ({ ...s, career: j.ranks })); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return state;
}

function RankList({ tracker, data, onWorkspaceChange }) {
  const { SchoolMark } = window.cfApp;
  const { Button } = window.CollegeForgeDesignSystem_e95e63;
  const { schools, official, extra, career, error } = useRankingSchools();
  const [copied, setCopied] = React.useState("");
  const collegeOf = (app) => (app.slug && (data.colleges || []).find((c) => c.slug === app.slug)) || null;
  const rows = schools ? window.cfRankList.rankList(tracker.apps, schools, official, extra, career) : [];
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
          <h1 className="cf-page-title">Ranked list</h1>
          <p className="cf-page-lede">Your schools, ordered by a weighted average of six rankings.</p>
          <details className="cf-rank-how">
            <summary>How the order is set</summary>
            <p className="cf-page-lede">U.S. News, Forbes and your own <a href="/rankings">career ranking</a> (My path, with the majors you picked there) count fully; Niche ¾, since part of it is student reviews; WSJ ½, since it swings year to year and only its top 100 is public; the Princeton Review ¼, since it rates cost and aid rather than overall strength. Liberal arts, Princeton Review and career ranks count at the national rank of the same standing, and a list a school isn’t on is left out.</p>
          </details>
        </div>
        {rows.length ? <div className="cf-row-actions">
          <Button size="sm" variant="secondary" onClick={copy}>{copied || "Copy colleges"}</Button>
        </div> : null}
      </header>
      {error ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>Couldn’t load the rankings. Reload the page to try again.</p> : null}
      {!tracker.apps.length ? <div className="cf-empty">Add schools on <a href="#shortlist">Your shortlist</a> and they’ll show up here, ranked.</div> : null}
      {schools && rows.length ? (
        <ol className="cf-apps-list cf-rank-list">
          {rows.map((r, i) => {
            const admitted = r.app.stage === "admitted";
            return (
            <li key={r.app.id} className={"cf-rank-row" + (admitted ? " is-admitted" : "")}>
              <span className="cf-rank-row__pos">{r.avg == null ? "" : i + 1}</span>
              <SchoolMark name={r.app.name} logo={r.app.logo} />
              <span className="cf-rank-row__name"><span className="cf-rank-row__label">{r.app.name}</span>{admitted ? <span className="cf-rank-row__tag">{r.app.status === "committed" ? "Committed" : "Admitted"}</span> : null}</span>
              <span className="cf-rank-row__src" title={window.cfRankList.rankSummary(r.ranks).title}>{r.avg == null ? "Not ranked" : window.cfRankList.rankSummary(r.ranks).text}</span>
              <span className="cf-rank-row__avg" title="Weighted average rank">{r.avg == null ? "—" : r.avg.toFixed(1)}</span>
              <span className="cf-rank-row__essay">{collegeOf(r.app) ? <window.EssaySchoolToggle data={data} school={collegeOf(r.app)} onWorkspaceChange={onWorkspaceChange} /> : null}</span>
            </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
window.RankList = RankList;
