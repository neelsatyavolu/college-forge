const { Button, SectionLabel } = window.CollegeForgeDesignSystem_e95e63;

const SCH_STATUSES = ["researching", "in_progress", "submitted", "won", "lost", "skipped"];
const AID = ["not_started", "in_progress", "submitted", "processed"];
const CSS = ["not_started", "in_progress", "submitted", "processed", "n_a"];
const STATUS_LABEL = { not_started: "Not Started", in_progress: "In Progress", submitted: "Submitted", processed: "Processed", n_a: "Not Needed", researching: "Researching", won: "Won", lost: "Not Awarded", skipped: "Skipped" };
const statusLabel = (s) => STATUS_LABEL[s] || s.replace(/_/g, " ");

function Panel({ title, action, children }) {
  return (
    <section style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--hairline)", background: "var(--surface-soft)" }}>
        <h2 className="cf-display" style={{ margin: 0, fontSize: 20, color: "var(--ink)" }}>{title}</h2>
        {action}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </section>
  );
}

function Track({ data, tracker, onAsk, onWorkspaceChange }) {
  const recs = data.recommendations || [];
  const sch = data.scholarships || [];
  const fa = data.financialAid || { fafsaStatus: "not_started", cssStatus: "not_started", idocStatus: "n_a" };
  const [schForm, setSchForm] = React.useState({ name: "", amount: "", deadline: "", url: "", slug: "" });
  const colleges = data.colleges || [];
  const schoolName = (slug) => { const c = colleges.find((x) => x.slug === slug); return c ? (c.short || c.name) : "school award"; };
  const won = sch.filter((s) => s.status === "won");
  const wonCount = won.length;
  // Same reading as lib/aid-plan.ts dollars(): "$5,000", "5000" and "$12.5k" count; "TBD" doesn't.
  const wonTotal = won.reduce((sum, s) => {
    const m = String(s.amount || "").replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*(k)?\b/i);
    return sum + (m ? Math.round(Number(m[1]) * (m[2] ? 1000 : 1)) : 0);
  }, 0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notes, setNotes] = React.useState(fa.notes || "");
  // Not applying for need-based aid: the aid forms fold to one line, so letters and scholarships lead.
  const needAid = data.onboarding && data.onboarding.listPrefs ? data.onboarding.listPrefs.needAid : undefined;
  const [showAid, setShowAid] = React.useState(false);
  const aidShown = needAid !== false || showAid;

  const patch = async (p) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      const ws = await window.cfApi.patch(p);
      if (onWorkspaceChange) onWorkspaceChange(ws);
    return true;
    } catch (e) { setError(e.message || "Could not save. Your changes are still here; please retry."); return false; }
    finally { setBusy(false); }
  };

  const addSch = async () => {
    if (!schForm.name.trim()) return;
    if (schForm.url && !/^https?:\/\//i.test(schForm.url)) { setError("Enter a scholarship URL starting with https:// or http://."); return; }
    const saved = await patch({
      scholarship: {
        name: schForm.name.trim(),
        amount: schForm.amount || undefined,
        deadline: schForm.deadline || undefined,
        url: schForm.url || undefined,
        status: "researching",
        ...(schForm.slug ? { slug: schForm.slug, kind: "school" } : {}),
      },
    });
    if (saved) setSchForm({ name: "", amount: "", deadline: "", url: "", slug: "" });
  };

  const fieldStyle = {
    padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)",
    background: "var(--canvas)", color: "var(--ink)", fontSize: 13, boxSizing: "border-box",
  };

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Recs &amp; aid</h1>
          <p className="cf-page-lede">
            Recommendation letters, financial aid and scholarships in one place. Check the official FAFSA and CSS Profile sites for your enrollment year, eligibility, and school-specific deadlines.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onAsk}>Ask copilot ✱</Button>
      </header>

      {error && <div className="cf-notice" role="alert">{error}</div>}
      {busy && <p role="status" style={{fontSize:12,color:"var(--muted)"}}>Saving changes…</p>}
      {needAid === false ? (
        <div className="cf-aid-off" role="status">
          <span>You said you're not applying for need-based aid.</span>
          <button type="button" className="cf-link-btn" aria-expanded={showAid} onClick={() => setShowAid((v) => !v)}>{showAid ? "Hide aid checklist" : "Show aid checklist anyway"}</button>
          <a className="cf-link-btn" href="#recommendations">Change</a>
        </div>
      ) : null}
      {aidShown ? (<React.Fragment>
      <Panel title="Financial aid checklist">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 12 }}>
          <label>
            <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 4 }}>FAFSA</div>
            <select value={fa.fafsaStatus || "not_started"} disabled={busy}
              onChange={(e) => patch({ financialAid: { fafsaStatus: e.target.value } })}
              style={{ ...fieldStyle, width: "100%" }}>
              {AID.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 4 }}>CSS Profile</div>
            <select value={fa.cssStatus || "not_started"} disabled={busy}
              onChange={(e) => patch({ financialAid: { cssStatus: e.target.value } })}
              style={{ ...fieldStyle, width: "100%" }}>
              {CSS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 4 }}>IDOC</div>
            <select value={fa.idocStatus || "n_a"} disabled={busy}
              onChange={(e) => patch({ financialAid: { idocStatus: e.target.value } })}
              style={{ ...fieldStyle, width: "100%" }}>
              {CSS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
          <a href="https://studentaid.gov/h/apply-for-aid/fafsa" target="_blank" rel="noopener noreferrer" style={{ color: "var(--coral)" }}>Open FAFSA →</a>
          <a href="https://cssprofile.collegeboard.org/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--coral)" }}>Open CSS Profile →</a>
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
          The FAFSA is the federal form every school uses for grants, work-study and federal loans. The CSS Profile is the College Board's longer form that many private colleges use to give their own grants. IDOC is the College Board's secure upload where some of those schools collect tax returns.
        </p>
        <textarea
          placeholder="Notes (special circumstances, noncustodial parent, fee waivers…)"
          aria-label="Financial aid notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          style={{ ...fieldStyle, width: "100%", marginTop: 12, fontFamily: "var(--font-body)" }}
        />
        <Button size="sm" variant="secondary" disabled={busy || notes === (fa.notes || "")} onClick={() => patch({ financialAid: { notes } })}>Save notes</Button>
      </Panel>

      {needAid !== false ? <window.AidEstimate Panel={Panel} revision={data.revision} busy={busy} onAsk={onAsk} onSave={(details) => patch({ aidProfile: details })} /> : null}

      <Panel title="Aid by school">
        <window.AidBySchool revision={data.revision} />
      </Panel>
      </React.Fragment>) : null}

      <LettersPanel Panel={Panel} recs={recs} tracker={tracker} busy={busy} patch={patch} fieldStyle={fieldStyle} onAsk={onAsk} />

      <Panel title={`Scholarships (${sch.length})`}>
        {wonCount ? (
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
            Won so far: <span className="cf-nums">{wonCount}</span>{wonTotal ? <React.Fragment> · <span className="cf-nums">${wonTotal.toLocaleString("en-US")}</span></React.Fragment> : null}
          </p>
        ) : null}
        {sch.length === 0 ? (
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--muted)" }}>Track external and school-specific scholarships here.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {sch.map((s) => (
              <div key={s.id} className="cf-tracker-row" style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>
                    {s.url && /^https?:\/\//i.test(s.url) ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{s.name}</a> : s.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {s.amount || "amount TBD"}{s.deadline ? ` · due ${s.deadline}` : ""}{s.slug ? ` · ${schoolName(s.slug)}` : ""}
                  </div>
                </div>
                <select aria-label={`Status for ${s.name}`} disabled={busy} value={s.status} onChange={(e) => patch({ scholarship: { id: s.id, status: e.target.value } })} style={fieldStyle}>
                  {SCH_STATUSES.map((st) => <option key={st} value={st}>{statusLabel(st)}</option>)}
                </select>
                <button type="button" disabled={busy} onClick={() => patch({ removeScholarshipId: s.id })}
                  style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 12 }}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
          <input aria-label="Scholarship name" placeholder="Name" value={schForm.name} onChange={(e) => setSchForm((f) => ({ ...f, name: e.target.value }))} style={fieldStyle} />
          <input aria-label="Scholarship amount" placeholder="Amount" value={schForm.amount} onChange={(e) => setSchForm((f) => ({ ...f, amount: e.target.value }))} style={fieldStyle} />
          <input type="date" aria-label="Scholarship deadline" value={schForm.deadline} onChange={(e) => setSchForm((f) => ({ ...f, deadline: e.target.value }))} style={fieldStyle} />
          <input aria-label="Scholarship url" placeholder="URL" value={schForm.url} onChange={(e) => setSchForm((f) => ({ ...f, url: e.target.value }))} style={fieldStyle} />
          <select aria-label="Scholarship school" value={schForm.slug} onChange={(e) => setSchForm((f) => ({ ...f, slug: e.target.value }))} style={fieldStyle}>
            <option value="">Outside scholarship</option>
            {colleges.map((c) => <option key={c.slug} value={c.slug}>From {c.short || c.name}</option>)}
          </select>
          <Button size="sm" onClick={addSch} disabled={busy || !schForm.name.trim()}>Add</Button>
        </div>
      </Panel>
    </div>
  );
}
window.Track = Track;
