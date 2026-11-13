const { Button } = window.CollegeForgeDesignSystem_e95e63;

function SharePanel({ data, onWorkspaceChange, onClose }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [copied, setCopied] = React.useState("");
  const links = (data.shares || []).filter((s) => !s.revokedAt);
  const url = (t) => `${window.location.origin}/hub/share.html?t=${encodeURIComponent(t)}`;
  const run = async (fn) => {
    setBusy(true); setError("");
    try { const j = await fn(); if (j && j.data && onWorkspaceChange) onWorkspaceChange(j.data); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const copy = async (t) => { try { await navigator.clipboard.writeText(url(t)); setCopied(t); setTimeout(() => setCopied(""), 1800); } catch (e) { setCopied(""); } };
  return (
    <section className="cf-panel" aria-labelledby="share-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 id="share-title">Share your progress</h2>
        <button type="button" className="cf-link-btn" onClick={onClose}>Done</button>
      </div>
      <p className="cf-help">A progress link shows parents or a counselor this page: every school, its status, dates, follow-ups, flags and decisions. They can leave you notes. It never shows your essays, portal logins, or a decision you haven’t opened yet. Make one link per person so you can turn each off on its own.</p>
      <form className="cf-fields" style={{ alignItems: "end" }} onSubmit={(e) => { e.preventDefault(); run(() => window.cfApi.postAction("create-share", { scope: "progress", label: label.trim() || "Progress link" })).then(() => setLabel("")); }}>
        <label className="cf-field" style={{ gridColumn: "span 2" }}>Who it’s for
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Mom and Dad, or Ms. Lee (counselor)" maxLength={60} />
        </label>
        <div><Button type="submit" size="sm" disabled={busy}>Create link</Button></div>
      </form>
      {error ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>{error}</p> : null}
      {links.length ? (
        <ul className="cf-apps-list">
          {links.map((l) => (
            <li key={l.token} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
              <span><strong style={{ fontWeight: 500, color: "var(--ink)" }}>{l.label}</strong><span className="cf-help" style={{ display: "block" }}>{l.scope === "progress" ? "Progress only" : "Full hub, for advisors"} · made {new Date(l.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></span>
              <span className="cf-row-actions">
                <Button size="sm" variant="secondary" onClick={() => copy(l.token)}>{copied === l.token ? "Copied" : "Copy link"}</Button>
                <button type="button" className="cf-link-btn cf-link-btn--danger" disabled={busy} onClick={() => run(() => window.cfApi.postAction("revoke-share", { token: l.token }))}>Turn off</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The progress page: the same view parents and counselors get through a progress link, editable here. */
function Progress({ data, tracker, onTrackerChange, onWorkspaceChange }) {
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");
  const [sharing, setSharing] = React.useState(false);
  const [flagText, setFlagText] = React.useState("");
  const act = async (body, message) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const j = await window.cfApi.applications(body);
      if (j.data) onTrackerChange(j.data);
      if (message) setNotice(message);
      return j;
    } catch (e) { setError(e.message); return null; } finally { setBusy(false); }
  };
  const links = (data.shares || []).filter((s) => !s.revokedAt && s.scope === "progress").length;
  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Progress</h1>
          <p className="cf-page-lede">Where every application stands, by round, with follow-ups and anything flagged. This is the page parents and counselors see when you share it{links ? ` (shared with ${links} ${links === 1 ? "person" : "people"})` : ""}.</p>
        </div>
        <div className="cf-row-actions">
          <Button size="sm" variant={sharing ? "secondary" : "primary"} onClick={() => setSharing(!sharing)}>Share progress</Button>
        </div>
      </header>
      {busy || notice ? <div role="status" aria-live="polite" className="cf-apps-progress">{busy ? "Saving…" : notice}</div> : <div role="status" aria-live="polite" className="cf-sr-only" />}
      {error ? <div role="alert" className="cf-notice">{error}</div> : null}
      {sharing ? <SharePanel data={data} onWorkspaceChange={onWorkspaceChange} onClose={() => setSharing(false)} /> : null}
      {tracker.apps.length ? (
        <React.Fragment>
          <ProgressView tracker={tracker} editable act={act} busy={busy} />
          <div className="cf-apps-footer">
            <form className="cf-flag-form" onSubmit={(e) => { e.preventDefault(); act({ action: "flag-add", text: flagText }, "Flag added.").then((ok) => ok && setFlagText("")); }}>
              <label className="cf-sr-only" htmlFor="new-flag">Flag something that needs attention</label>
              <input id="new-flag" value={flagText} onChange={(e) => setFlagText(e.target.value)} placeholder="Flag something that needs attention" maxLength={500} />
              <Button type="submit" size="sm" variant="secondary" disabled={busy || !flagText.trim()}>Flag it</Button>
            </form>
            <a className="cf-link-btn" href="#applications" style={{ display: "inline-flex", alignItems: "center" }}>Edit schools, dates and logins on Applications →</a>
          </div>
        </React.Fragment>
      ) : <div className="cf-empty">Add schools on the <a href="#applications">Applications</a> tab and they’ll show up here by round.</div>}
    </div>
  );
}

window.Progress = Progress;
