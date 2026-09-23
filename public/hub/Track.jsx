const { Badge, Button, SectionLabel } = window.CollegeForgeDesignSystem_e95e63;

const REC_STATUSES = ["not_asked", "asked", "in_progress", "submitted", "waived"];
const SCH_STATUSES = ["researching", "in_progress", "submitted", "won", "lost", "skipped"];
const AID = ["not_started", "in_progress", "submitted", "processed"];
const CSS = ["not_started", "in_progress", "submitted", "processed", "n_a"];

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

function Track({ data, onAsk, onWorkspaceChange }) {
  const recs = data.recommendations || [];
  const sch = data.scholarships || [];
  const fa = data.financialAid || { fafsaStatus: "not_started", cssStatus: "not_started" };
  const [recForm, setRecForm] = React.useState({ name: "", type: "teacher", subject: "", deadline: "" });
  const [schForm, setSchForm] = React.useState({ name: "", amount: "", deadline: "", url: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notes, setNotes] = React.useState(fa.notes || "");

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

  const addRec = async () => {
    if (!recForm.name.trim()) return;
    const saved = await patch({
      recommendation: {
        name: recForm.name.trim(),
        type: recForm.type,
        subject: recForm.subject || undefined,
        deadline: recForm.deadline || undefined,
        status: "not_asked",
      },
    });
    if (saved) setRecForm({ name: "", type: "teacher", subject: "", deadline: "" });
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
      },
    });
    if (saved) setSchForm({ name: "", amount: "", deadline: "", url: "" });
  };

  const fieldStyle = {
    padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)",
    background: "var(--canvas)", color: "var(--ink)", fontSize: 13, boxSizing: "border-box",
  };

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Letters &amp; financial aid</h1>
          <p className="cf-page-lede">
            Keep recommendation letters, scholarships, and financial aid in one place. Check the official FAFSA and CSS Profile sites for your enrollment year, eligibility, and school-specific deadlines.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onAsk}>Ask copilot ✱</Button>
      </header>

      {error && <div className="cf-notice" role="alert">{error}</div>}
      {busy && <p role="status" style={{fontSize:12,color:"var(--muted)"}}>Saving changes…</p>}
      <Panel title="Financial aid checklist">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 12 }}>
          <label>
            <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 4 }}>FAFSA</div>
            <select value={fa.fafsaStatus || "not_started"} disabled={busy}
              onChange={(e) => patch({ financialAid: { fafsaStatus: e.target.value } })}
              style={{ ...fieldStyle, width: "100%" }}>
              {AID.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 4 }}>CSS Profile</div>
            <select value={fa.cssStatus || "not_started"} disabled={busy}
              onChange={(e) => patch({ financialAid: { cssStatus: e.target.value } })}
              style={{ ...fieldStyle, width: "100%" }}>
              {CSS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
          <a href="https://studentaid.gov/h/apply-for-aid/fafsa" target="_blank" rel="noopener noreferrer" style={{ color: "var(--coral)" }}>Open FAFSA →</a>
          <a href="https://cssprofile.collegeboard.org/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--coral)" }}>Open CSS Profile →</a>
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--muted)" }}>
          Tip: create FSA IDs early for student + parent. Net price calculators live on each school’s Explore detail page when available.
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

      <Panel title={`Recommendation letters (${recs.length})`} action={<Badge variant="cream" uppercase>LOR tracker</Badge>}>
        {recs.length === 0 ? (
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--muted)" }}>No recommenders yet. Add your counselor and teachers here.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {recs.map((r) => (
              <div key={r.id} className="cf-tracker-row" style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.type}{r.subject ? ` · ${r.subject}` : ""}{r.deadline ? ` · due ${r.deadline}` : ""}</div>
                </div>
                <select aria-label={`Status for ${r.name}`} disabled={busy} value={r.status} onChange={(e) => patch({ recommendation: { id: r.id, status: e.target.value } })}
                  style={fieldStyle}>
                  {REC_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
                <button type="button" disabled={busy} onClick={() => patch({ removeRecommendationId: r.id })}
                  style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 12 }}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
          <input aria-label="Recommender name" placeholder="Name" value={recForm.name} onChange={(e) => setRecForm((f) => ({ ...f, name: e.target.value }))} style={fieldStyle} />
          <select aria-label="Recommender type" value={recForm.type} onChange={(e) => setRecForm((f) => ({ ...f, type: e.target.value }))} style={fieldStyle}>
            <option value="counselor">counselor</option>
            <option value="teacher">teacher</option>
            <option value="other">other</option>
          </select>
          <input aria-label="Recommender subject" placeholder="Subject" value={recForm.subject} onChange={(e) => setRecForm((f) => ({ ...f, subject: e.target.value }))} style={fieldStyle} />
          <input aria-label="Recommender deadline" placeholder="Deadline" value={recForm.deadline} onChange={(e) => setRecForm((f) => ({ ...f, deadline: e.target.value }))} style={fieldStyle} />
          <Button size="sm" onClick={addRec} disabled={busy || !recForm.name.trim()}>Add</Button>
        </div>
      </Panel>

      <Panel title={`Scholarships (${sch.length})`}>
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
                    {s.amount || "amount TBD"}{s.deadline ? ` · due ${s.deadline}` : ""}
                  </div>
                </div>
                <select aria-label={`Status for ${s.name}`} disabled={busy} value={s.status} onChange={(e) => patch({ scholarship: { id: s.id, status: e.target.value } })} style={fieldStyle}>
                  {SCH_STATUSES.map((st) => <option key={st} value={st}>{st.replace(/_/g, " ")}</option>)}
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
          <input aria-label="Scholarship deadline" placeholder="Deadline" value={schForm.deadline} onChange={(e) => setSchForm((f) => ({ ...f, deadline: e.target.value }))} style={fieldStyle} />
          <input aria-label="Scholarship url" placeholder="URL" value={schForm.url} onChange={(e) => setSchForm((f) => ({ ...f, url: e.target.value }))} style={fieldStyle} />
          <Button size="sm" onClick={addSch} disabled={busy || !schForm.name.trim()}>Add</Button>
        </div>
      </Panel>
    </div>
  );
}
window.Track = Track;
