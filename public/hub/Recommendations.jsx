const { Button } = window.CollegeForgeDesignSystem_e95e63;

function recommendationMoney(value) {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value) : "Not reported";
}

function Recommendations({ data, onWorkspaceChange, onAsk, onNavigate }) {
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [revision, setRevision] = React.useState(0);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const prefs = data.onboarding?.listPrefs || {};
  const [draft, setDraft] = React.useState(() => ({ intended: data.profile.intended || "", ambition: prefs.ambition || "balanced", regions: prefs.regions || [], settings: prefs.settings || [] }));
  const profileKey = JSON.stringify([data.applicant.gpaUnweighted, data.applicant.sat, data.applicant.satNote, data.profile.intended, data.profile.testing, data.onboarding?.listPrefs]);
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/colleges/recommendations", { credentials: "same-origin", signal: controller.signal })
      .then(async res => { const j = await res.json(); if (!res.ok || !j.success) throw new Error(j.error || "Couldn’t load recommendations."); return j.data; })
      .then(value => { setResult(value); setLoading(false); })
      .catch(e => { if (e.name !== "AbortError") { setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, [profileKey, revision]);
  const savePrefs = async e => {
    e.preventDefault(); setBusy("preferences"); setError("");
    try {
      const ws = await window.cfApi.patch({ profile: { intended: draft.intended.trim() }, listPrefs: { ambition: draft.ambition, regions: draft.regions, settings: draft.settings } });
      onWorkspaceChange(ws); setFiltersOpen(false); setNotice("Preferences saved. Your recommendations have been refreshed.");
    } catch (e) { setError(e.message || "Couldn’t save preferences."); }
    setBusy("");
  };
  const add = async college => {
    setBusy(college.slug); setError(""); setNotice("");
    try {
      const res = await fetch("/api/workspace/colleges", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ college }) });
      const j = await res.json(); if (!res.ok || !j.success) throw new Error(j.error || "Couldn’t save this college.");
      onWorkspaceChange(j.data); setNotice(`${college.name} added to your shortlist.`);
    } catch (e) { setError(e.message); }
    setBusy("");
  };
  const toggle = (field, value) => setDraft(d => ({ ...d, [field]: d[field].includes(value) ? d[field].filter(v => v !== value) : [...d[field], value] }));
  return (
    <div className="cf-page">
      <header className="cf-page-header"><div><div className="cf-eyebrow" style={{ marginBottom: 10 }}>EVIDENCE FIRST. YOUR PRIORITIES ALWAYS.</div><h1 className="cf-page-title">Colleges for you</h1><p className="cf-page-lede">A starting list grounded in graduate outcomes, your academic profile, and what matters to you. Explore the reasons before you decide.</p></div><Button variant="secondary" size="sm" onClick={() => { setDraft({ intended: data.profile.intended || "", ambition: prefs.ambition || "balanced", regions: prefs.regions || [], settings: prefs.settings || [] }); setFiltersOpen(v => !v); }}>Adjust preferences</Button></header>
      {filtersOpen && <form className="cf-preference-form" onSubmit={savePrefs}>
        <div className="cf-preference-fields"><label>Intended major<input value={draft.intended} onChange={e => setDraft(d => ({ ...d, intended: e.target.value }))} placeholder="e.g. Computer Science" /></label><label>List balance<select value={draft.ambition} onChange={e => setDraft(d => ({ ...d, ambition: e.target.value }))}><option value="balanced">Balanced mix</option><option value="ambitious">More reaches</option><option value="conservative">More likely options</option></select></label></div>
        <fieldset><legend>Regions <span>Leave all unchecked for anywhere</span></legend><div>{[["northeast", "New England"], ["mid-atlantic", "Mid-Atlantic"], ["south", "South"], ["midwest", "Midwest"], ["west", "West"]].map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.regions.includes(value)} onChange={() => toggle("regions", value)} />{label}</label>)}</div></fieldset>
        <fieldset><legend>Campus setting <span>Leave all unchecked for any setting</span></legend><div>{[["urban", "City"], ["suburban", "Suburban"], ["college-town", "College town"], ["rural", "Rural"]].map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.settings.includes(value)} onChange={() => toggle("settings", value)} />{label}</label>)}</div></fieldset>
        <div className="cf-inline-actions"><Button disabled={!!busy} type="submit">{busy === "preferences" ? "Saving…" : "Update recommendations"}</Button><Button variant="secondary" type="button" onClick={() => setFiltersOpen(false)}>Cancel</Button></div>
      </form>}
      {error && <div className="cf-notice" role="alert">{error} <button className="cf-quiet-button" onClick={() => setRevision(v => v + 1)}>Try loading again</button></div>}
      {notice && <div className="cf-notice" role="status">{notice}</div>}
      <div className="cf-recommendation-intro"><div><strong>{data.profile.intended || "Exploring your options"}</strong><p>{data.profile.intended ? "Major evidence appears where published data is available." : "Add your major and academics to make this list more personal."} <a href="#profile">Edit profile →</a></p></div><Button variant="secondary" size="sm" onClick={() => onAsk("Review my recommended colleges using the ranking evidence. Explain the best fits, compare the source evidence, flag missing information, and help me build a balanced list. Do not change my saved list until I ask.")}>Discuss with AI ✱</Button></div>
      {loading ? <div className="cf-notice" role="status">Finding colleges in the ranking data…</div> : result && <React.Fragment>
        {result.profileGaps.length > 0 && <details className="cf-notice"><summary>Make this list more useful · {result.profileGaps.length} things to check</summary><ul>{result.profileGaps.map(gap => <li key={gap}>{gap}</li>)}</ul></details>}
        <div className="cf-section-heading"><h2>{result.recommendations.length} starting points</h2><span>250-college snapshot · {result.generatedAt}</span></div>
        <div className="cf-recommendation-grid">{result.recommendations.map(row => {
          const { college, fit, evidence } = row;
          const saved = data.colleges.some(c => c.slug === college.slug || c.scorecardId === college.scorecardId);
          return <article key={college.slug} className="cf-recommendation-card"><div className="cf-journey-top" style={{ margin: 0 }}><span className="cf-tier-label">{fit.label}{fit.tier ? " · provisional" : " · more information needed"}</span><span>Career rank #{evidence.fairRank}</span></div><h2>{college.name}</h2><p className="cf-recommendation-location">{college.location}{college.setting ? ` · ${college.setting}` : ""}</p><dl className="cf-recommendation-metrics"><div><dt>Purchasing-power earnings<br />historical, 2024 dollars</dt><dd>{recommendationMoney(evidence.adjustedEarnings)}</dd></div><div><dt>Average annual net price<br />historical, after grants</dt><dd>{recommendationMoney(evidence.netPrice)}</dd></div></dl><div className="cf-eyebrow">WHY IT’S HERE</div><ul>{fit.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><details><summary>What to verify before applying</summary><ul>{fit.cautions.map(caution => <li key={caution}>{caution}</li>)}<li>Rank interval: {evidence.rankLow}–{evidence.rankHigh}. Overlapping intervals do not support a precise ordering.</li><li>Net price is not your financial-aid offer. Check the school’s net price calculator.</li></ul></details><div className="cf-recommendation-actions"><Button size="sm" variant={saved ? "secondary" : "primary"} disabled={!!busy || saved} onClick={() => add(college)}>{saved ? "Saved ✓" : busy === college.slug ? "Saving…" : "Add to shortlist"}</Button><a href={evidence.scorecardUrl} target="_blank" rel="noreferrer">College Scorecard ↗</a><button className="cf-quiet-button" style={{ marginTop: 0 }} onClick={() => onAsk(`Use the recommendation evidence to explain whether ${college.name} fits my profile. Use the published evidence and flag uncertainty. Do not change my shortlist.`)}>Ask AI</button></div></article>;
        })}</div>
        {result.recommendations.length === 0 && <div className="cf-friendly-empty"><h3>No colleges match these filters in this snapshot.</h3><p>Try another region or campus setting, or explore the wider college search.</p><Button onClick={() => onNavigate("explore")}>Explore all colleges</Button></div>}
        <details className="cf-methodology"><summary>How this list is made · sources & limitations</summary><p>{result.methodology}</p><ul>{result.limitations.map(text => <li key={text}>{text}</li>)}</ul><div className="cf-inline-actions">{result.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</div></details>
      </React.Fragment>}
    </div>
  );
}
window.Recommendations = Recommendations;
