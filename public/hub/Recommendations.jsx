const { Button } = window.CollegeForgeDesignSystem_e95e63;

function recommendationMoney(value) {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value) : "Not reported";
}

const APP_COUNTS = [8, 9, 10, 11, 12, 13, 14, 15];
const BUDGETS = [["lt15", "Under $15,000 a year"], ["15-30", "$15,000–$30,000 a year"], ["30-50", "$30,000–$50,000 a year"], ["50plus", "$50,000 or more a year"], ["unsure", "Not sure yet"]];
const NOTES_LIMIT = 4000;

function preferenceDraft(data) {
  const prefs = data.onboarding?.listPrefs || {};
  return {
    intended: data.profile.intended || "", ambition: prefs.ambition || "balanced", regions: prefs.regions || [], settings: prefs.settings || [],
    appCount: typeof prefs.appCount === "number" ? String(prefs.appCount) : "", notes: prefs.notes || "",
    budget: prefs.budget || "", needAid: prefs.needAid === true ? "yes" : prefs.needAid === false ? "no" : "", ed: prefs.ed || "",
  };
}

function Recommendations({ data, onWorkspaceChange, onAsk, onNavigate, onStartSetup }) {
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [revision, setRevision] = React.useState(0);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [draft, setDraft] = React.useState(() => preferenceDraft(data));
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
      const listPrefs = {
        ambition: draft.ambition, regions: draft.regions, settings: draft.settings,
        appCount: draft.appCount ? Number(draft.appCount) : null, notes: draft.notes.slice(0, NOTES_LIMIT),
        // Same answer as onboarding and Recs & aid: yes, no, or not sure (left unanswered).
        needAid: draft.needAid === "yes" ? true : draft.needAid === "no" ? false : null,
        ...(draft.budget ? { budget: draft.budget } : {}), ...(draft.ed ? { ed: draft.ed } : {}),
      };
      const ws = await window.cfApi.patch({ profile: { intended: draft.intended.trim() }, listPrefs });
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
      <header className="cf-page-header"><div><div className="cf-eyebrow" style={{ marginBottom: 10 }}>EVIDENCE FIRST. YOUR PRIORITIES ALWAYS.</div><h1 className="cf-page-title">Colleges for you</h1><p className="cf-page-lede">A starting list grounded in graduate outcomes, your academic profile, and what matters to you. Explore the reasons before you decide.</p></div><Button variant="secondary" size="sm" onClick={() => { setDraft(preferenceDraft(data)); setFiltersOpen(v => !v); }}>Adjust preferences</Button></header>
      {filtersOpen && <form className="cf-preference-form" onSubmit={savePrefs}>
        <div className="cf-preference-fields"><label>Intended major<input value={draft.intended} onChange={e => setDraft(d => ({ ...d, intended: e.target.value }))} placeholder="e.g. Computer Science" /></label><label>List balance<select value={draft.ambition} onChange={e => setDraft(d => ({ ...d, ambition: e.target.value }))}><option value="balanced">Balanced mix</option><option value="ambitious">More reaches</option><option value="conservative">More likely options</option></select></label>
          <label>Number of applications<select value={draft.appCount} onChange={e => setDraft(d => ({ ...d, appCount: e.target.value }))}><option value="">No target</option>{APP_COUNTS.map(n => <option key={n} value={String(n)}>{n}</option>)}</select></label>
          <label>Yearly amount your family can pay<select value={draft.budget} onChange={e => setDraft(d => ({ ...d, budget: e.target.value }))}>{draft.budget ? null : <option value="" disabled>Choose one</option>}{BUDGETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Early Decision<select value={draft.ed} onChange={e => setDraft(d => ({ ...d, ed: e.target.value }))}>{draft.ed ? null : <option value="" disabled>Choose one</option>}<option value="yes">I would apply ED</option><option value="maybe">Maybe</option><option value="no">No ED</option></select></label>
          <label style={{ gridColumn: "1 / -1" }}>Anything else the list should follow<textarea value={draft.notes} maxLength={NOTES_LIMIT} rows={3} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="e.g. strong marine biology, in-state publics, no schools in big cities" style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", color: "var(--ink)", background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 6, font: "inherit", fontSize: 13, resize: "vertical" }} /></label></div>
        <fieldset><legend>Applying for need-based aid?</legend><div>{[["yes", "Yes"], ["no", "No"], ["", "Not sure"]].map(([value, label]) => <label key={label}><input type="radio" name="cf-need-aid" checked={draft.needAid === value} onChange={() => setDraft(d => ({ ...d, needAid: value }))} />{label}</label>)}</div></fieldset>
        <fieldset><legend>Regions <span>Leave all unchecked for anywhere</span></legend><div>{[["northeast", "New England"], ["mid-atlantic", "Mid-Atlantic"], ["south", "South"], ["midwest", "Midwest"], ["west", "West"]].map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.regions.includes(value)} onChange={() => toggle("regions", value)} />{label}</label>)}</div></fieldset>
        <fieldset><legend>Campus setting <span>Leave all unchecked for any setting</span></legend><div>{[["urban", "City"], ["suburban", "Suburban"], ["college-town", "College town"], ["rural", "Rural"]].map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.settings.includes(value)} onChange={() => toggle("settings", value)} />{label}</label>)}</div></fieldset>
        <div className="cf-inline-actions"><Button disabled={!!busy} type="submit">{busy === "preferences" ? "Saving…" : "Update recommendations"}</Button><Button variant="secondary" type="button" onClick={() => setFiltersOpen(false)}>Cancel</Button></div>
      </form>}
      {error && <div className="cf-notice" role="alert">{error} <button className="cf-quiet-button" onClick={() => setRevision(v => v + 1)}>Try loading again</button></div>}
      {notice && <div className="cf-notice" role="status">{notice}</div>}
      <div className="cf-recommendation-intro"><div><strong>{data.profile.intended || "Exploring your options"}</strong><p>{data.profile.intended ? "Major evidence appears where published data is available." : "Add your major and academics to make this list more personal."} <a href="#profile">Edit profile →</a>{!data.applicant.name && onStartSetup ? <React.Fragment>{" "}<button type="button" className="cf-link-btn" onClick={onStartSetup}>Or answer a few questions to build a list →</button></React.Fragment> : null}</p></div><Button variant="secondary" size="sm" onClick={() => onAsk("Review my recommended colleges using the ranking evidence. Explain the best fits, compare the source evidence, flag missing information, and help me build a balanced list. Do not change my saved list until I ask.")}>Discuss with AI ✱</Button></div>
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
