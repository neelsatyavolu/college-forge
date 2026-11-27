const { Badge, Button } = window.CollegeForgeDesignSystem_e95e63;

const REC_STATUS_LIST = ["not_asked", "asked", "in_progress", "submitted", "waived"];
const RECEIPT_TONE = { received: "var(--success)", missing: "var(--warning)", unclear: "var(--accent-amber)", "no portal data": "var(--muted-soft)" };
const RECEIPT_WORDS = {
  received: "portal shows it received", missing: "portal shows it missing",
  unclear: "some letters of this type are in, but the portal doesn't say whose", "no portal data": "no portal data yet",
};

const recHelpers = () => window.cfRecommenders || { receiptFor: () => [], letterTasks: () => [] };
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const receiptTitle = (r) => {
  const count = r.matched === "type" && r.total ? ` (${r.done} of ${r.total} letters of this type in, not matched by name)` : "";
  return `${r.name}: ${RECEIPT_WORDS[r.state]}${count}`;
};

function ReceiptDot({ state }) {
  return <span aria-hidden="true" style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: RECEIPT_TONE[state] || "var(--muted-soft)", flex: "none" }} />;
}

/** A text field's local value that follows the saved one until the student edits it, then saves on blur. */
function useDraftField(saved, save) {
  const [value, setValue] = React.useState(saved);
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => { if (!dirty) setValue(saved); }, [saved, dirty]);
  const onChange = (e) => { setValue(e.target.value); setDirty(true); };
  const onBlur = async () => {
    if (!dirty) return;
    if (value === saved) { setDirty(false); return; }
    if (await save(value)) setDirty(false);
  };
  return { value, onChange, onBlur };
}

/** One recommender's per-school details: email, asked date, schools, thank-you and brag sheet. */
function LetterDetails({ rec, apps, busy, patch, fieldStyle, onAsk }) {
  const email = useDraftField(rec.email || "", (v) => patch({ recommendation: { id: rec.id, email: v.trim() } }));
  const brag = useDraftField(rec.bragSheet || "", (v) => patch({ recommendation: { id: rec.id, bragSheet: v } }));
  const assigned = new Set(rec.schools || []);
  const allOn = apps.length > 0 && apps.every((a) => assigned.has(a.id));
  const setSchools = (ids) => patch({ recommendation: { id: rec.id, schools: ids } });
  const toggle = (id) => setSchools(assigned.has(id) ? (rec.schools || []).filter((s) => s !== id) : [...(rec.schools || []), id]);
  const label = { fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 4 };
  return (
    <div style={{ display: "grid", gap: 14, padding: "12px 0 4px", borderTop: "1px solid var(--hairline-soft)", marginTop: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        <label>
          <div style={label}>Email</div>
          <input type="email" maxLength={254} {...email} placeholder="teacher@school.org" style={{ ...fieldStyle, width: "100%" }} />
        </label>
        <label>
          <div style={label}>Asked on</div>
          <input type="date" value={rec.askedAt || ""} disabled={busy}
            onChange={(e) => patch({ recommendation: { id: rec.id, askedAt: e.target.value, ...(e.target.value && rec.status === "not_asked" ? { status: "asked" } : {}) } })}
            style={{ ...fieldStyle, width: "100%" }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "end", fontSize: 13, color: "var(--ink)" }}>
          <input type="checkbox" checked={!!rec.thankYouSent} disabled={busy} onChange={(e) => patch({ recommendation: { id: rec.id, thankYouSent: e.target.checked } })} />
          Thank-you note sent
        </label>
      </div>
      <div>
        <div style={{ ...label, display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>Sends to</span>
          {apps.length ? (
            <button type="button" className="cf-link-btn" disabled={busy} style={{ fontSize: 11, textTransform: "none", letterSpacing: 0 }}
              onClick={() => setSchools(allOn ? [] : apps.map((a) => a.id))}>
              {allOn ? "Clear all" : "All schools"}
            </button>
          ) : null}
        </div>
        {apps.length ? (
          <div role="group" aria-label={`Schools ${rec.name} sends to`} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {apps.map((a) => {
              const on = assigned.has(a.id);
              return (
                <button key={a.id} type="button" aria-pressed={on} disabled={busy} onClick={() => toggle(a.id)}
                  style={{ ...fieldStyle, padding: "4px 10px", borderRadius: "var(--radius-pill)", cursor: "pointer", fontSize: 12,
                    background: on ? "var(--workspace-accent-soft)" : "var(--canvas)", borderColor: on ? "var(--workspace-accent)" : "var(--hairline)" }}>
                  {a.name}
                </button>
              );
            })}
          </div>
        ) : <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Add schools on Progress to assign this letter to them.</p>}
      </div>
      <label>
        <div style={label}>Brag sheet</div>
        <textarea rows={3} maxLength={4000} {...brag}
          placeholder="What you want them to know: activities, a project from their class, your intended major…"
          style={{ ...fieldStyle, width: "100%", fontFamily: "var(--font-body)" }} />
      </label>
      <div>
        <button type="button" className="cf-link-btn" onClick={() => onAsk && onAsk(`Use draft_rec_request to draft a recommendation request email and brag-sheet outline for ${rec.name}. Show me the text; I'll send it myself.`)}>
          Draft request with copilot ✱
        </button>
      </div>
    </div>
  );
}

/** The recommendation-letter tracker on Letters & aid (moved out of Track.jsx). */
function LettersPanel({ Panel, recs, tracker, busy, patch, fieldStyle, onAsk }) {
  const apps = (tracker && tracker.apps) || [];
  const [form, setForm] = React.useState({ name: "", type: "teacher", subject: "", deadline: "" });
  const [open, setOpen] = React.useState(null);
  const add = async () => {
    if (!form.name.trim()) return;
    const saved = await patch({
      recommendation: { name: form.name.trim(), type: form.type, subject: form.subject || undefined, deadline: form.deadline || undefined, status: "not_asked" },
    });
    if (saved) setForm({ name: "", type: "teacher", subject: "", deadline: "" });
  };
  return (
    <Panel title={`Recommendation letters (${recs.length})`} action={<Badge variant="cream" uppercase>LOR tracker</Badge>}>
      {recs.length === 0 ? (
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--muted)" }}>No recommenders yet. Add your counselor and teachers here, then pick the schools each letter goes to.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {recs.map((r) => {
            const receipts = recHelpers().receiptFor(r, tracker, recs);
            const meta = [r.type, r.subject, r.deadline ? `due ${r.deadline}` : "", r.askedAt ? `asked ${r.askedAt}` : "", r.thankYouSent ? "thanked" : ""].filter(Boolean).join(" · ");
            return (
              <div key={r.id} className="cf-tracker-row" style={{ padding: "10px 12px", border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 10, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{meta}</div>
                  </div>
                  <select aria-label={`Status for ${r.name}`} disabled={busy} value={r.status} onChange={(e) => patch({ recommendation: { id: r.id, status: e.target.value } })} style={fieldStyle}>
                    {REC_STATUS_LIST.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                  <button type="button" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}
                    style={{ border: "none", background: "transparent", color: "var(--ink)", cursor: "pointer", fontSize: 12 }}>{open === r.id ? "Close" : "Details"}</button>
                  <button type="button" disabled={busy} onClick={() => patch({ removeRecommendationId: r.id })}
                    style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 12 }}>Remove</button>
                </div>
                {receipts.length ? (
                  <ul aria-label={`Where ${r.name}'s letter stands`} style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                    {receipts.map((x) => (
                      <li key={x.appId} title={receiptTitle(x)} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--body)" }}>
                        <ReceiptDot state={x.state} />{x.name}<span className="cf-sr-only">: {RECEIPT_WORDS[x.state]}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {open === r.id ? <LetterDetails key={r.id} rec={r} apps={apps} busy={busy} patch={patch} fieldStyle={fieldStyle} onAsk={onAsk} /> : null}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        <input aria-label="Recommender name" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={fieldStyle} />
        <select aria-label="Recommender type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} style={fieldStyle}>
          <option value="counselor">counselor</option>
          <option value="teacher">teacher</option>
          <option value="other">other</option>
        </select>
        <input aria-label="Recommender subject" placeholder="Subject" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} style={fieldStyle} />
        <input aria-label="Recommender deadline" placeholder="Deadline" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} style={fieldStyle} />
        <Button size="sm" onClick={add} disabled={busy || !form.name.trim()}>Add</Button>
      </div>
    </Panel>
  );
}

/** "Letters still missing" on Progress: what the student owes their recommenders, soonest first. Each line can be
 * cleared: Asked and Sent update the recommender; Dismiss hides a portal nudge in this browser. */
function LetterTasks({ data, tracker, onWorkspaceChange }) {
  const { Button } = window.CollegeForgeDesignSystem_e95e63;
  const hiddenKey = "cf-letter-nudges-hidden:" + ((data && data.draftStorageKey) || "local");
  const [hidden, setHidden] = React.useState(() => {
    try { return new Set(JSON.parse(window.localStorage.getItem(hiddenKey) || "[]")); } catch (e) { return new Set(); }
  });
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const nudgeId = (t) => `${t.recId}:${t.appId || ""}:${t.due || ""}`;
  const tasks = recHelpers().letterTasks((data && data.recommendations) || [], tracker, todayIso())
    .filter((t) => t.kind !== "nudge" || !hidden.has(nudgeId(t)));
  if (!tasks.length) return null;
  const save = async (t, recommendation) => {
    setBusy(`${t.recId}-${t.kind}`);
    setError("");
    try {
      const ws = await window.cfApi.patch({ recommendation: { id: t.recId, ...recommendation } });
      if (onWorkspaceChange) onWorkspaceChange(ws);
    } catch (e) {
      setError(e.message || "Couldn’t save. Try again.");
    } finally { setBusy(""); }
  };
  const dismiss = (t) => {
    const next = new Set(hidden).add(nudgeId(t));
    setHidden(next);
    try { window.localStorage.setItem(hiddenKey, JSON.stringify([...next])); } catch (e) { /* this session only */ }
  };
  const action = (t) => {
    const working = busy === `${t.recId}-${t.kind}`;
    if (t.kind === "ask") return <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => save(t, { status: "asked", askedAt: todayIso() })}>{working ? "Saving…" : "Asked"}</Button>;
    if (t.kind === "thank") return <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => save(t, { thankYouSent: true })}>{working ? "Saving…" : "Sent"}</Button>;
    return <button type="button" className="cf-link-btn" onClick={() => dismiss(t)}>Dismiss</button>;
  };
  return (
    <section className="cf-panel" aria-labelledby="letter-tasks-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 id="letter-tasks-title">Letters still missing</h2>
        <a className="cf-link-btn" href="#track">Recs, aid &amp; scholarships →</a>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        {tasks.map((t, i) => (
          <li key={`${t.recId}-${t.kind}-${t.appId || i}`} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 36, fontSize: 14, color: "var(--ink)" }}>
            <span style={{ flex: 1, minWidth: 0 }}>{t.text}</span>
            {t.due ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: t.overdue ? "var(--error)" : "var(--muted)" }}>{t.overdue ? "overdue · " : t.kind === "ask" ? "ask by " : "due "}{t.due}</span> : null}
            {action(t)}
          </li>
        ))}
      </ul>
      {error ? <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: "var(--error)" }}>{error}</p> : null}
    </section>
  );
}

window.LettersPanel = LettersPanel;
window.LetterTasks = LetterTasks;
