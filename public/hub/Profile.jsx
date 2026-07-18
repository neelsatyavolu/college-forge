const { StatCard, Badge, VerdictBadge, SectionLabel, Tile, Button } = window.CollegeForgeDesignSystem_e95e63;

const LEVEL_TONE = { National: "top", International: "top", State: "good", School: "neutral" };
const DESC_LIMIT = 150;
const MAX_ACT = 10;
const MAX_HON = 5;

function Field({ label, value }) {
  const empty = value === undefined || value === null || value === "" || value === "—" || value === " · Class of ";
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: empty ? "var(--muted-soft)" : "var(--ink)" }}>{empty ? "—" : value}</div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || ""}
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)", fontSize: 14 }} />
    </label>
  );
}

function Panel({ title, action, children }) {
  return (
    <section style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--hairline)", background: "var(--surface-soft)" }}>
        <h2 className="cf-display" style={{ margin: 0, fontSize: 20, color: "var(--ink)" }}>{title}</h2>
        {action}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </section>
  );
}

function ActivityRow({ a }) {
  const [open, setOpen] = React.useState(a.rank === 1);
  const over = (a.desc || "").length > DESC_LIMIT;
  return (
    <div style={{ borderTop: a.rank === 1 ? "none" : "1px solid var(--hairline-soft)" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ width: "100%", textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: "14px 0", display: "flex", gap: 14, alignItems: "flex-start" }}>
        <span className="cf-nums" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "var(--radius-pill)", background: "var(--surface-card)", color: "var(--ink)", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontSize: 12, marginTop: 2 }}>{a.rank}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="cf-display" style={{ fontSize: 18, color: "var(--ink)" }}>{a.name}</span>
            {a.college ? <Badge variant="teal">Continue in college</Badge> : null}
            {over ? <Badge variant="coral" uppercase>Over 150 chars</Badge> : null}
          </span>
          <span style={{ display: "block", fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{a.type} · {a.role} · {a.years}</span>
        </span>
        <span className="cf-nums" style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{a.hpw} hr/wk · {a.wpy} wk/yr</span>
        <span aria-hidden style={{ flexShrink: 0, color: "var(--muted-soft)", marginTop: 3, transform: open ? "rotate(90deg)" : "none", transition: "transform 140ms ease" }}>›</span>
      </button>
      {open ? (
        <div style={{ padding: "0 0 16px 40px" }}>
          <p style={{ margin: "0 0 6px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>{a.desc}</p>
          <div className="cf-nums" style={{ fontSize: 11, color: over ? "var(--error)" : "var(--muted-soft)", marginBottom: 10 }}>
            {(a.desc || "").length}/{DESC_LIMIT} chars (Common App limit)
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {(a.bullets || []).map((b, i) => (
              <li key={i} style={{ display: "flex", gap: 8, fontSize: 13.5, color: "var(--body)", lineHeight: 1.5 }}>
                <span style={{ color: "var(--coral)", flexShrink: 0 }}>→</span><span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function hsLabel(p) {
  if (p.hs && p.gradYear) return `${p.hs} · Class of ${p.gradYear}`;
  if (p.hs) return p.hs;
  if (p.gradYear) return `Class of ${p.gradYear}`;
  return "";
}

function Profile({ data, onAsk, onWorkspaceChange }) {
  const p = data.profile;
  const a = data.applicant;
  const topHonors = p.honors.filter((h) => h.top).length;
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [draft, setDraft] = React.useState(null);

  const startEdit = () => {
    setDraft({
      name: a.name || "",
      cycle: a.cycle || "",
      year: a.year || "",
      gpaWeighted: a.gpaWeighted === "—" ? "" : a.gpaWeighted || "",
      gpaUnweighted: a.gpaUnweighted === "—" ? "" : a.gpaUnweighted || "",
      sat: (p.testing.sat === "—" ? "" : p.testing.sat) || "",
      satNote: p.testing.satNote || "",
      intended: p.intended || "",
      hs: p.hs || "",
      gradYear: p.gradYear || "",
      location: p.location || "",
      counselor: p.counselor || "",
      residency: p.residency || "",
      activitiesJson: JSON.stringify(p.activities, null, 2),
      honorsJson: JSON.stringify(p.honors, null, 2),
    });
    setErr("");
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      let activities = p.activities;
      let honors = p.honors;
      try {
        activities = JSON.parse(draft.activitiesJson);
        if (!Array.isArray(activities)) throw new Error("activities must be an array");
        if (activities.length > MAX_ACT) throw new Error(`Common App allows max ${MAX_ACT} activities`);
      } catch (e) {
        throw new Error("Activities JSON: " + e.message);
      }
      try {
        honors = JSON.parse(draft.honorsJson);
        if (!Array.isArray(honors)) throw new Error("honors must be an array");
        if (honors.length > MAX_HON) throw new Error(`Common App allows max ${MAX_HON} honors`);
      } catch (e) {
        throw new Error("Honors JSON: " + e.message);
      }
      const ws = await window.cfApi.patch({
        applicant: {
          name: draft.name,
          cycle: draft.cycle,
          year: draft.year,
          gpaWeighted: draft.gpaWeighted || "—",
          gpaUnweighted: draft.gpaUnweighted || "—",
          sat: draft.sat || "—",
          satNote: draft.satNote,
          awards: honors.length,
        },
        profile: {
          intended: draft.intended,
          hs: draft.hs,
          gradYear: draft.gradYear,
          location: draft.location,
          counselor: draft.counselor,
          residency: draft.residency,
          testing: { sat: draft.sat || "—", satNote: draft.satNote },
          activities,
          honors,
        },
      });
      if (onWorkspaceChange) onWorkspaceChange(ws);
      setEditing(false);
    } catch (e) {
      setErr(e.message || "Save failed");
    }
    setBusy(false);
  };

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <SectionLabel style={{ marginBottom: 10 }}>Your profile</SectionLabel>
          <h1 className="cf-page-title">Everything on file</h1>
          <p className="cf-page-lede">
            Transcript, testing, coursework, activities, and honors. Edit directly or ask the copilot. Activities follow Common App limits: up to {MAX_ACT} slots, {DESC_LIMIT}-character descriptions; up to {MAX_HON} honors.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!editing ? (
            <Button variant="secondary" size="sm" onClick={startEdit}>Edit profile</Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            </>
          )}
          <Button variant="secondary" size="sm" onClick={onAsk}>Copilot ✱</Button>
        </div>
      </header>

      {err ? <div style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--error) 12%, transparent)", color: "var(--error)", fontSize: 13 }}>{err}</div> : null}

      {editing && draft ? (
        <div style={{ display: "grid", gap: 16, marginBottom: 28 }}>
          <Panel title="Identity & academics">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              <Input label="Name" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
              <Input label="Cycle" value={draft.cycle} onChange={(v) => setDraft((d) => ({ ...d, cycle: v }))} placeholder="Fall 2027" />
              <Input label="Year label" value={draft.year} onChange={(v) => setDraft((d) => ({ ...d, year: v }))} />
              <Input label="GPA weighted" value={draft.gpaWeighted} onChange={(v) => setDraft((d) => ({ ...d, gpaWeighted: v }))} />
              <Input label="GPA unweighted" value={draft.gpaUnweighted} onChange={(v) => setDraft((d) => ({ ...d, gpaUnweighted: v }))} />
              <Input label="SAT" value={draft.sat} onChange={(v) => setDraft((d) => ({ ...d, sat: v }))} />
              <Input label="SAT note" value={draft.satNote} onChange={(v) => setDraft((d) => ({ ...d, satNote: v }))} />
              <Input label="Intended major" value={draft.intended} onChange={(v) => setDraft((d) => ({ ...d, intended: v }))} />
              <Input label="High school" value={draft.hs} onChange={(v) => setDraft((d) => ({ ...d, hs: v }))} />
              <Input label="Grad year" value={String(draft.gradYear)} onChange={(v) => setDraft((d) => ({ ...d, gradYear: v }))} />
              <Input label="Location" value={draft.location} onChange={(v) => setDraft((d) => ({ ...d, location: v }))} />
              <Input label="Counselor" value={draft.counselor} onChange={(v) => setDraft((d) => ({ ...d, counselor: v }))} />
              <Input label="Residency" value={draft.residency} onChange={(v) => setDraft((d) => ({ ...d, residency: v }))} />
            </div>
          </Panel>
          <Panel title={`Activities JSON (max ${MAX_ACT})`}>
            <textarea value={draft.activitiesJson} onChange={set("activitiesJson")} rows={12}
              style={{ width: "100%", boxSizing: "border-box", fontFamily: "var(--font-mono)", fontSize: 12, padding: 12, borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)" }} />
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>Fields: rank, name, type, role, years, hpw, wpy, college, desc (≤{DESC_LIMIT} chars), bullets[]</p>
          </Panel>
          <Panel title={`Honors JSON (max ${MAX_HON})`}>
            <textarea value={draft.honorsJson} onChange={set("honorsJson")} rows={6}
              style={{ width: "100%", boxSizing: "border-box", fontFamily: "var(--font-mono)", fontSize: 12, padding: 12, borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)" }} />
          </Panel>
        </div>
      ) : null}

      <section className="cf-grid-4 cf-nums" style={{ marginBottom: 24 }}>
        <StatCard label="Weighted GPA" value={data.applicant.gpaWeighted || "—"} hint={`${data.applicant.gpaUnweighted || "—"} unweighted`} />
        <StatCard label="SAT" value={p.testing.sat || "—"} hint={p.testing.satNote || "from testing"} variant="cream" />
        <StatCard label="AP exams" value={String(p.testing.aps.length)} hint={p.testing.aps.length ? p.testing.aps.map((x) => x.score).join(" · ") : "none yet"} />
        <StatCard label="Honors" value={String(p.honors.length)} hint={`${topHonors} top · max ${MAX_HON} on CA`} />
      </section>

      <div className="cf-grid-profile">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel title={`Activities (${p.activities.length}/${MAX_ACT})`} action={<Badge variant="cream" uppercase>Common App order</Badge>}>
            {p.activities.length === 0 ? (
              <div className="cf-empty-soft" style={{ border: "none", background: "transparent", padding: 0 }}>No activities yet — upload a resume or use Edit / copilot.</div>
            ) : p.activities.map((act) => <ActivityRow key={act.rank + act.name} a={act} />)}
          </Panel>

          <Panel title={`Honors & awards (${p.honors.length}/${MAX_HON})`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {p.honors.length === 0 ? (
                <div className="cf-empty-soft" style={{ border: "none", background: "transparent", padding: 0 }}>No honors yet.</div>
              ) : p.honors.map((h, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--hairline)", background: h.top ? "color-mix(in srgb, var(--coral) 4%, transparent)" : "var(--canvas)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ color: h.top ? "var(--accent-amber)" : "var(--hairline)", flexShrink: 0 }}>★</span>
                    <span style={{ fontSize: 14, color: "var(--ink)" }}>{h.title}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span className="cf-nums" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>{h.year}</span>
                    <VerdictBadge tone={LEVEL_TONE[h.level] || "neutral"}>{h.level}</VerdictBadge>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel title="Applicant">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Intended major" value={p.intended} />
              <Field label="High school" value={hsLabel(p)} />
              <Field label="Location" value={p.location} />
              <Field label="Counselor" value={p.counselor} />
              <Field label="Residency" value={p.residency} />
            </div>
          </Panel>

          <Panel title="Testing">
            {p.testing.aps.length === 0 ? (
              <div className="cf-empty-soft" style={{ border: "none", background: "transparent", padding: 0 }}>No AP scores yet.</div>
            ) : (
              <div className="cf-nums" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {p.testing.aps.map((ap, i) => <Tile key={i} label={ap.course} value={ap.score} />)}
              </div>
            )}
          </Panel>

          <Panel title="Coursework">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[["Honors", p.coursework.honors], ["AP", p.coursework.aps], ["Senior (planned)", p.coursework.senior]].map(([label, list]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 6 }}>{label}</div>
                  {(list || []).length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--muted-soft)" }}>—</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(list || []).map((c) => <span key={c} style={{ fontSize: 12.5, padding: "3px 9px", background: "var(--surface-card)", borderRadius: "var(--radius-xs)", color: "var(--ink)" }}>{c}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
window.Profile = Profile;
