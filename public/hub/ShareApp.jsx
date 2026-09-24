const { Badge, Button, SectionLabel } = window.CollegeForgeDesignSystem_e95e63;

function tokenFromUrl() {
  const q = new URLSearchParams(window.location.search);
  return q.get("t") || q.get("token") || "";
}

function ShareApp() {
  const token = tokenFromUrl();
  const [state, setState] = React.useState({ loading: true, error: "", data: null, label: "" });
  const [note, setNote] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [noteError, setNoteError] = React.useState("");
  const [essayId, setEssayId] = React.useState("");
  const [msg, setMsg] = React.useState("");

  const load = React.useCallback(async () => {
    if (!token) {
      setState({ loading: false, error: "Missing share token in the URL.", data: null, label: "" });
      return;
    }
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const res = await fetch("/api/share/" + encodeURIComponent(token));
      const j = await res.json();
      if (!res.ok || !j.success) {
        setState({ loading: false, error: j.error || "Link invalid", data: null, label: "" });
        return;
      }
      setState({ loading: false, error: "", data: j.data, label: j.label || "Shared hub" });
    } catch (e) {
      setState({ loading: false, error: "Could not load this share link.", data: null, label: "" });
    }
  }, [token]);

  React.useEffect(() => { load(); }, [load]);

  const submitNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    setMsg("");
    setNoteError("");
    try {
      const res = await fetch("/api/share/" + encodeURIComponent(token), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: note.trim(), author: author.trim() || "Advisor", ...(essayId ? { essayId } : {}) }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Failed");
      setState((s) => ({ ...s, data: j.data }));
      setNote("");
      setMsg("Note sent to the student.");
    } catch (e) {
      setNoteError(e.message || "Could not post note");
    }
    setBusy(false);
  };

  if (state.loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>
        Loading shared hub…
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <div className="cf-display" style={{ fontSize: 28, color: "var(--ink)", marginBottom: 12 }}>Link unavailable</div>
          <p role="alert" style={{ color: "var(--muted)", fontSize: 14 }}>{state.error}</p>
          {token ? <Button onClick={load}>Try again</Button> : null}
        </div>
      </div>
    );
  }

  const d = state.data;
  const a = d.applicant || {};
  const p = d.profile || {};
  const essays = [...(d.essays?.commonApp || []), ...Object.entries(d.essays?.supplements || {}).flatMap(([school, items]) => items.map((essay) => ({ ...essay, group: essay.group || school })))];
  const timeline = [...(d.criticalDates || []).map((date) => ({ date: date.date, title: date.label, detail: date.detail })),
    ...(d.colleges || []).flatMap((college) => (college.deadlines?.length ? window.cfDeadlinePlan.planDeadlines(college) : college.deadline ? [{ date: college.deadline, plan: "Application" }] : []).map((date) => ({ date: date.date, title: `${college.name} — ${date.plan}` }))),
    ...(d.scholarships || []).filter((scholarship) => scholarship.deadline).map((scholarship) => ({ date: scholarship.deadline, title: `Scholarship: ${scholarship.name}` })),
    ...(d.recommendations || []).filter((letter) => letter.deadline).map((letter) => ({ date: letter.deadline, title: `Letter: ${letter.name}` }))];

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "32px 20px 80px" }}>
      <header style={{ marginBottom: 32, borderBottom: "1px solid var(--hairline)", paddingBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ color: "var(--coral)", fontSize: 22 }}>✱</span>
          <span className="cf-display" style={{ fontSize: 22, color: "var(--ink)" }}>College Forge</span>
          <Badge variant="cream" uppercase>Read-only share</Badge>
        </div>
        <h1 className="cf-display" style={{ margin: "0 0 8px", fontSize: "clamp(28px, 4vw, 36px)", color: "var(--ink)" }}>
          {a.name || "Student"} — advisor view
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
          {state.label} · {a.cycle || ""} {a.year ? "· " + a.year : ""} · You can leave notes; you cannot edit the student hub.
        </p>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginBottom: 28 }}>
        {[
          ["GPA W", a.gpaWeighted],
          ["GPA UW", a.gpaUnweighted],
          ["SAT", a.sat],
          ["Awards", a.awards],
        ].map(([l, v]) => (
          <div key={l} style={{ padding: 14, border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)", background: "var(--canvas)" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)" }}>{l}</div>
            <div className="cf-display cf-nums" style={{ fontSize: 24, color: "var(--ink)" }}>{v ?? "—"}</div>
          </div>
        ))}
      </section>

      <section style={{ marginBottom: 28 }}>
        <SectionLabel style={{ marginBottom: 10 }}>Profile</SectionLabel>
        <div style={{ fontSize: 14, color: "var(--body)", lineHeight: 1.6 }}>
          <div><strong>Major:</strong> {p.intended || "—"}</div>
          <div><strong>HS:</strong> {p.hs || "—"} · Class of {p.gradYear || "—"}</div>
          <div><strong>Location:</strong> {p.location || "—"}</div>
          <div><strong>Counselor:</strong> {p.counselor || "—"}</div>
        </div>
      </section>

      {d.ed ? (
        <section style={{ marginBottom: 28, padding: 16, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--coral) 10%, transparent)" }}>
          <SectionLabel style={{ marginBottom: 6 }}>Early Decision</SectionLabel>
          <div className="cf-display" style={{ fontSize: 22 }}>{d.ed.school}</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Deadline {d.ed.deadline || "—"}</div>
        </section>
      ) : null}

      <section style={{ marginBottom: 28 }}>
        <SectionLabel style={{ marginBottom: 10 }}>School list ({(d.colleges || []).length})</SectionLabel>
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {(d.colleges || []).map((c) => {
            const st = (d.applications && d.applications[c.slug] && d.applications[c.slug].status) || "researching";
            return (
              <li key={c.slug} style={{ padding: "10px 0", borderBottom: "1px solid var(--hairline-soft)", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span style={{ color: "var(--ink)" }}><strong>{c.name || c.short}</strong> · {c.tier === "safety" ? "Likely" : c.tier || "Not assessed"} · {c.deadline || "TBD"}</span>
                <Badge variant="cream" uppercase>{st}</Badge>
              </li>
            );
          })}
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <SectionLabel style={{ marginBottom: 10 }}>Top activities</SectionLabel>
        <ol style={{ margin: 0, paddingLeft: 20, color: "var(--body)", fontSize: 14 }}>
          {[...(p.activities || [])].sort((x, y) => x.rank - y.rank).slice(0, 8).map((act) => (
            <li key={act.rank + act.name} style={{ marginBottom: 8 }}>
              <strong>{act.name}</strong> — {act.role || ""} ({act.hpw || "?"} hr/wk)
              {act.desc ? <div style={{ color: "var(--muted)", fontSize: 13 }}>{act.desc}</div> : null}
            </li>
          ))}
        </ol>
      </section>

      <section style={{ marginBottom: 28 }}>
        <SectionLabel style={{ marginBottom: 10 }}>Recommendation letters</SectionLabel>
        {(d.recommendations || []).length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>None tracked.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 14 }}>
            {(d.recommendations || []).map((r) => (
              <li key={r.id} style={{ padding: "6px 0" }}>{r.name} ({r.type}) — {r.status}</li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: 28 }}>
        <SectionLabel style={{ marginBottom: 10 }}>Financial aid</SectionLabel>
        <p style={{ fontSize: 14, color: "var(--body)" }}>
          FAFSA: <strong>{(d.financialAid && d.financialAid.fafsaStatus) || "—"}</strong>
          {" · "}
          CSS: <strong>{(d.financialAid && d.financialAid.cssStatus) || "—"}</strong>
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <SectionLabel style={{ marginBottom: 10 }}>Timeline & deadlines</SectionLabel>
        {timeline.length ? <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "var(--body)" }}>
          {timeline.map((event, index) => <li key={index} style={{ marginBottom: 8 }}><strong>{event.date}</strong> · {event.title}{event.detail ? <div style={{ color: "var(--muted)", fontSize: 13 }}>{event.detail}</div> : null}</li>)}
        </ul> : <p style={{ color: "var(--muted)", fontSize: 14 }}>No deadlines tracked yet.</p>}
      </section>

      <section style={{ marginBottom: 28 }}>
        <SectionLabel style={{ marginBottom: 10 }}>Essay drafts</SectionLabel>
        {essays.length ? essays.map((essay) => {
          const draft = d.essayDrafts?.[essay.id] ?? essay.starter ?? "";
          const count = /character/i.test(essay.unit) ? Array.from(draft).length : draft.trim() ? draft.trim().split(/\s+/).length : 0;
          return <details key={essay.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--hairline-soft)" }}>
            <summary style={{ cursor: "pointer", fontSize: 14, color: "var(--ink)", lineHeight: 1.5 }}>{essay.group ? `${essay.group} · ` : ""}{essay.label} <span style={{ color: "var(--muted)", fontSize: 12 }}>{count}/{essay.limit} {essay.unit}</span></summary>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>{essay.prompt}</p>
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 14, lineHeight: 1.7, color: "var(--body)" }}>{draft.trim() ? draft : "No draft yet."}</div>
          </details>;
        }) : <p style={{ color: "var(--muted)", fontSize: 14 }}>No essay prompts tracked yet.</p>}
      </section>

      <section style={{ marginBottom: 28, padding: 20, border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", background: "var(--surface-soft)" }}>
        <SectionLabel style={{ marginBottom: 10 }}>Leave a note for the student</SectionLabel>
        <label htmlFor="advisor-name" style={{ display: "block", marginBottom: 6, fontSize: 13 }}>Your name</label>
        <input id="advisor-name" maxLength={80}
          placeholder="Your name"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)" }}
        />
        <label style={{ display: "block", fontSize: 13, marginBottom: 8 }}>Feedback about
          <select value={essayId} onChange={(event) => setEssayId(event.target.value)} style={{ display: "block", width: "100%", padding: 8, marginTop: 6, color: "var(--ink)", background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-sm)" }}>
            <option value="">General guidance</option>
            {essays.map((essay) => <option key={essay.id} value={essay.id}>{essay.group ? `${essay.group} · ` : ""}{essay.label}</option>)}
          </select>
        </label>
        <label htmlFor="advisor-note" style={{ display: "block", marginBottom: 6, fontSize: 13 }}>Your note</label>
        <textarea id="advisor-note" maxLength={4000}
          placeholder="Feedback on essays, list balance, deadlines…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)", fontFamily: "var(--font-body)", fontSize: 14 }}
        />
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{note.length}/4000 characters</div>
        {noteError ? <p role="alert" style={{ color: "var(--error)", fontSize: 13 }}>{noteError}</p> : null}
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button size="sm" onClick={submitNote} disabled={busy || !note.trim()}>{busy ? "Sending…" : "Send note"}</Button>
          {msg ? <span role="status" style={{ fontSize: 13, color: "var(--muted)" }}>{msg}</span> : null}
        </div>
      </section>

      {(d.advisorNotes || []).length > 0 ? (
        <section>
          <SectionLabel style={{ marginBottom: 10 }}>Notes so far</SectionLabel>
          {(d.advisorNotes || []).map((n) => (
            <div key={n.id} style={{ marginBottom: 12, padding: 12, border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)" }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{n.author} · {new Date(n.createdAt).toLocaleString()}</div>
              <div style={{ fontSize: 14, color: "var(--body)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{n.body}</div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<ShareApp />);
