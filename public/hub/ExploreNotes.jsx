// School-page sections built from Forge's own sourced data (lib/explore-catalog.ts exploreExtras):
// other publications' ranks, research notes, net price by income, deadlines, essay prompts,
// campus grades, switching majors, international aid and nursing entry.

const RANK_LISTS = [
  ["usn", "U.S. News", "National"],
  ["lac", "U.S. News", "Liberal arts"],
  ["forbes", "Forbes", "America’s Top Colleges"],
  ["niche", "Niche", "Best Colleges"],
  ["wsj", "WSJ", "Best Colleges"],
  ["prPrivate", "Princeton Review", "Best value, private"],
  ["prPublic", "Princeton Review", "Best value, public"],
  ["forge", "Forge", "Career outcomes"],
];

const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "source"; } };

function SourceLink({ url, date, thirdParty }) {
  if (!url) return null;
  return (
    <a className="cf-explore-source" href={url} target="_blank" rel="noopener noreferrer">
      {host(url)}{date ? ` · ${date}` : ""}{thirdParty ? " · third-party" : ""} ↗
    </a>
  );
}

function ExploreRankings({ rankings, rank, lacRank }) {
  const r = { ...(rankings || {}) };
  if (rank && !r.usn) r.usn = rank;
  if (lacRank && !r.lac) r.lac = lacRank;
  const rows = RANK_LISTS.filter(([k]) => typeof r[k] === "number");
  if (!rows.length) return null;
  return (
    <ul className="cf-explore-ranks" aria-label="Rankings">
      {rows.map(([k, pub, list]) => (
        <li key={k}><span className="cf-explore-ranks__n">#{r[k]}</span><span className="cf-explore-ranks__pub">{pub}</span><span className="cf-explore-ranks__list">{list}</span></li>
      ))}
    </ul>
  );
}

function ExploreNotesList({ notes }) {
  if (!notes || !notes.length) return null;
  return (
    <dl className="cf-explore-notes">
      {notes.map((n, i) => (
        <div key={i}>
          <dt>{n.label}</dt>
          <dd><span>{n.value}</span><SourceLink url={n.sourceUrl} date={n.checkedAt} thirdParty={n.thirdParty} /></dd>
        </div>
      ))}
    </dl>
  );
}

function ExploreIncomeTable({ rows }) {
  if (!rows || !rows.length) return null;
  return (
    <div className="cf-explore-income">
      <h4>Net price by family income</h4>
      <dl>
        {rows.map((r) => (
          <div key={r.band}><dt>{r.band}</dt><dd>{r.value}</dd></div>
        ))}
      </dl>
      <SourceLink url={rows[0].sourceUrl} />
    </div>
  );
}

function ExploreDeadlines({ deadlines }) {
  if (!deadlines || !deadlines.length) return null;
  return (
    <ul className="cf-explore-deadlines">
      {deadlines.map((d, i) => (
        <li key={i}>
          <span className="cf-explore-deadlines__plan">{d.plan}</span>
          <span className="cf-explore-deadlines__date">{d.date}</span>
          {d.note ? <span className="cf-explore-deadlines__note">{d.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function ExploreEssays({ essays }) {
  if (!essays || !essays.length) return null;
  return (
    <ol className="cf-explore-essays">
      {essays.map((e, i) => (
        <li key={i}>
          <div className="cf-explore-essays__meta">
            {e.label ? <strong>{e.label}</strong> : null}
            {e.limit ? <span>{e.limit} {e.unit || "words"}</span> : null}
            {e.required === false ? <span>Optional</span> : null}
          </div>
          <p>{e.prompt}</p>
        </li>
      ))}
    </ol>
  );
}

const GRADES = [["overall", "Overall"], ["campus", "Campus"], ["dorms", "Dorms"], ["food", "Food"]];

function ExploreCampusLife({ niche }) {
  if (!niche) return null;
  const rows = GRADES.filter(([k]) => niche[k]);
  if (!rows.length) return null;
  return (
    <dl className="cf-explore-grades">
      {rows.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{niche[k]}</dd></div>)}
    </dl>
  );
}

const SWITCH_TONE = { 1: "open", 2: "bar", 2.5: "bar", 3: "hard", 4: "hard" };

function ExploreSwitching({ switching }) {
  if (!switching || !switching.length) return null;
  return (
    <ul className="cf-explore-switch">
      {switching.map((s) => (
        <li key={s.major}><span>{s.major}</span><span className={`cf-explore-switch__lv is-${SWITCH_TONE[s.level] || "bar"}`}>{s.label}</span></li>
      ))}
    </ul>
  );
}

const NURSING_LINE = {
  direct: "First-years are admitted straight into the BSN.",
  both: "Some first-years get a direct nursing seat; the rest apply later.",
  competitive: "Pre-nursing first, then a competitive application to the major.",
  none: "No four-year BSN for first-years.",
};

function ExploreSpecialNotes({ intlAid, nursing }) {
  if (!intlAid?.label && !nursing?.entry) return null;
  return (
    <dl className="cf-explore-notes">
      {intlAid?.label ? (
        <div><dt>International students</dt><dd><span>{intlAid.label[0].toUpperCase() + intlAid.label.slice(1)}.</span><SourceLink url={intlAid.source} /></dd></div>
      ) : null}
      {nursing?.entry ? (
        <div><dt>Nursing</dt><dd><span>{NURSING_LINE[nursing.entry]}{nursing.note ? ` ${nursing.note}` : ""}</span><SourceLink url={nursing.sourceUrl} /></dd></div>
      ) : null}
    </dl>
  );
}

function ExplorePhotoCredit({ credit }) {
  if (!credit) return null;
  return (
    <p className="cf-explore-credit">
      Photo: <a href={credit.page} target="_blank" rel="noopener noreferrer">{credit.by}</a>, {credit.license}, via Wikimedia Commons
    </p>
  );
}

Object.assign(window, {
  ExploreRankings, ExploreNotesList, ExploreIncomeTable, ExploreDeadlines, ExploreEssays,
  ExploreCampusLife, ExploreSwitching, ExploreSpecialNotes, ExplorePhotoCredit,
});
