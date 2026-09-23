const { Button } = window.CollegeForgeDesignSystem_e95e63;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function timelineDate(label, graduationYear) {
  const iso = String(label).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const named = String(label).match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (!iso && !named) return null;
  const month = iso ? Number(iso[2]) - 1 : MONTHS.indexOf(named[1].slice(0, 3).toLowerCase());
  const day = Number(iso ? iso[3] : named[2]);
  const explicitYear = iso ? iso[1] : named[3];
  const year = Number(explicitYear || (graduationYear ? graduationYear - (month >= 6 ? 1 : 0) : 0));
  if (!year || month < 0 || month > 11) return null;
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return { date, inferred: !explicitYear };
}

const PLAN_TONE = (plan) =>
  /Early Decision|ED/.test(plan) ? { bg: "var(--coral)", fg: "var(--on-primary)", label: "ED" }
  : /Restrictive|REA/.test(plan) ? { bg: "var(--accent-amber)", fg: "var(--ink)", label: "REA" }
  : /Early Action|EA/.test(plan) ? { bg: "var(--accent-teal)", fg: "var(--on-primary)", label: "EA" }
  : /Scholarship|priority/i.test(plan) ? { bg: "var(--warning)", fg: "var(--ink)", label: "$" }
  : { bg: "var(--surface-cream-strong)", fg: "var(--muted)", label: "RD" };

function Timeline({ data, onAsk, onWorkspaceChange }) {
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState({ date: "", label: "", detail: "" });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const graduationYear = Number(data.profile && data.profile.gradYear) || null;
  const dates = data.criticalDates || [];
  const saveDates = async (next) => {
    setSaving(true);
    setError("");
    try {
      const ws = await window.cfApi.patch({ criticalDates: next });
      if (onWorkspaceChange) onWorkspaceChange(ws);
      setEditing(null);
    } catch (e) { setError(e.message || "Could not save dates. Please try again."); }
    finally { setSaving(false); }
  };
  const startEdit = (index) => {
    const existing = index >= 0 ? dates[index] : {date:"",label:"",detail:""};
    const parsed = timelineDate(existing.date, graduationYear);
    const date = parsed ? [parsed.date.getFullYear(), String(parsed.date.getMonth()+1).padStart(2,"0"), String(parsed.date.getDate()).padStart(2,"0")].join("-") : "";
    setForm({...existing, date});
    setEditing(index);
    setError("");
  };
  // Merge critical dates + every school deadline into one sorted stream.
  const events = [];
  dates.forEach((m, index) => events.push({ date: m.date, title: m.label, detail: m.detail, kind: "milestone", index }));
  (data.colleges || []).forEach((c) =>
    (c.deadlines || []).forEach((d) => events.push({ date: d.date, title: `${c.short} — ${d.plan}`, detail: c.major, plan: d.plan, kind: "deadline" }))
  );
  events.forEach((event) => { event.parsed = timelineDate(event.date, graduationYear); });
  events.sort((a, b) => (a.parsed ? a.parsed.date.getTime() : Infinity) - (b.parsed ? b.parsed.date.getTime() : Infinity));

  // Group by month label.
  const byMonth = [];
  events.forEach((e) => {
    const mon = e.parsed ? e.parsed.date.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "Check date";
    let g = byMonth.find((x) => x.mon === mon);
    if (!g) { g = { mon, items: [] }; byMonth.push(g); }
    g.items.push(e);
  });

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Timeline</h1>
          <p className="cf-page-lede">Every milestone and application deadline across your cycle, in order. ED/EA/REA plans are flagged.</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Button variant="secondary" size="sm" onClick={onAsk}>Ask about a date ✱</Button>
          <Button size="sm" onClick={() => startEdit(-1)}>Add a milestone</Button>
        </div>
      </header>

      <p style={{color:"var(--muted)",fontSize:13,marginBottom:20}}>Confirm school deadlines on the official admissions site. Dates without a year use your graduation year’s application cycle; set a full date to remove ambiguity.</p>
      {error ? <p role="alert" style={{color:"var(--error)"}}>{error}</p> : null}
      {editing !== null ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!form.label.trim() || !timelineDate(form.date, graduationYear)) return;
          const milestone = {...form, label:form.label.trim()};
          saveDates(editing < 0 ? [...dates,milestone] : dates.map((date,index) => index === editing ? milestone : date));
        }} style={{padding:20,border:"1px solid var(--hairline)",borderRadius:"var(--radius-md)",marginBottom:24,display:"grid",gap:12}}>
          <h2 className="cf-display" style={{margin:0,fontSize:20}}>{editing < 0 ? "New milestone" : "Edit milestone"}</h2>
          <label>Title<input required aria-label="Milestone title" maxLength={160} value={form.label} onChange={(e)=>setForm({...form,label:e.target.value})} style={{display:"block",width:"100%",padding:10,boxSizing:"border-box"}} placeholder="Request teacher recommendations" /></label>
          <label>Date<input required aria-label="Milestone date" type="date" value={form.date} onChange={(e)=>setForm({...form,date:e.target.value})} style={{display:"block",padding:10}} /></label>
          <label>Notes (optional)<input aria-label="Milestone notes" value={form.detail} onChange={(e)=>setForm({...form,detail:e.target.value})} style={{display:"block",width:"100%",padding:10,boxSizing:"border-box"}} /></label>
          <div style={{display:"flex",gap:8}}><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save milestone"}</Button><Button variant="secondary" disabled={saving} onClick={()=>setEditing(null)}>Cancel</Button></div>
        </form>
      ) : null}
      {byMonth.length === 0 ? (
        <div className="cf-empty">
          No dates yet. Add your first milestone above, or add schools with verified deadlines to your list.
        </div>
      ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {byMonth.map((g) => (
          <section key={g.mon} style={{ display: "grid", gridTemplateColumns: "minmax(56px, 80px) 1fr", gap: "clamp(12px, 3vw, 24px)" }}>
            <div style={{ paddingTop: 4 }}>
              <div className="cf-display" style={{ fontSize: 22, color: "var(--ink)", position: "sticky", top: 100 }}>{g.mon}</div>
            </div>
            <div style={{ borderLeft: "1px solid var(--hairline)", paddingLeft: "clamp(16px, 3vw, 24px)", paddingBottom: 24, position: "relative" }}>
              {g.items.map((e, i) => {
                const tone = e.kind === "deadline" ? PLAN_TONE(e.plan) : null;
                return (
                  <div key={i} style={{ position: "relative", marginBottom: i === g.items.length - 1 ? 0 : 16 }}>
                    <span style={{ position: "absolute", left: "calc(-1 * clamp(16px, 3vw, 24px) - 6px)", top: 6, width: 10, height: 10, borderRadius: "50%", background: e.kind === "milestone" ? "var(--ink)" : (tone ? tone.bg : "var(--muted)"), border: "2px solid var(--canvas)", boxShadow: "0 0 0 1px var(--hairline)" }} />
                    <div style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span className="cf-nums" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>{e.parsed ? e.parsed.date.toLocaleDateString("en-US", {month:"short",day:"numeric",year:"numeric"}) : e.date}{e.parsed && e.parsed.inferred ? " · year inferred" : ""}</span>
                          <span className="cf-display" style={{ fontSize: 17, color: "var(--ink)" }}>{e.title}</span>
                        </div>
                        {e.detail ? <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{e.detail}</div> : null}
                      </div>
                      {tone ? (
                        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.5px", padding: "3px 9px", borderRadius: "var(--radius-pill)", background: tone.bg, color: tone.fg }}>{tone.label}</span>
                      ) : (
                        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted-soft)" }}>Milestone</span>
                      )}
                      {e.kind === "milestone" ? <div style={{display:"flex",gap:8}}><Button variant="secondary" size="sm" disabled={saving} onClick={()=>startEdit(e.index)}>Edit</Button><Button variant="ghost" size="sm" disabled={saving} onClick={()=>saveDates(dates.filter((_,index)=>index !== e.index))}>Remove</Button></div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      )}
    </div>
  );
}
window.cfTimelineDate = timelineDate;
window.Timeline = Timeline;
