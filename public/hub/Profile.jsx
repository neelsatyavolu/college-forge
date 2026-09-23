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

function Input({ label, value, onChange, placeholder, type = "text", min, max, step, inputMode, hint }) {
  const hintId = React.useId();
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <input type={type} inputMode={inputMode} aria-describedby={hint ? hintId : undefined} min={min} max={max} step={step} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || ""}
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)", fontSize: 14 }} />
      {hint ? <span id={hintId} style={{ display: "block", marginTop: 4, fontSize: 12, color: "var(--muted)" }}>{hint}</span> : null}
    </label>
  );
}

const editorGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 12 };

function TextInput({ label, value, onChange, hint, rows = 3 }) {
  return <label style={{ display: "block", fontSize: 13, color: "var(--body)" }}>
    <span style={{ display: "block", marginBottom: 6 }}>{label}</span>
    <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={rows}
      style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: 10, borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)", font: "inherit" }} />
    {hint ? <span style={{ display: "block", color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{hint}</span> : null}
  </label>;
}

function EditorItem({ title, children, onRemove, actions }) {
  return <fieldset style={{ minWidth: 0, margin: 0, padding: 16, border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)", display: "grid", gap: 12 }}>
    <legend style={{ padding: "0 6px", fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{title}</legend>
    {children}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}<Button size="sm" variant="secondary" onClick={onRemove}>Remove {title.toLowerCase()}</Button></div>
  </fieldset>;
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
      <button type="button" className="cf-activity-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ width: "100%", textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: "14px 0", display: "flex", gap: 14, alignItems: "flex-start" }}>
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
      activities: p.activities.map((activity) => ({ ...activity })),
      honors: p.honors.map((honor) => ({ ...honor })),
      aps: p.testing.aps.map((ap) => ({ ...ap })),
      coursework: Object.fromEntries(["honors", "aps", "senior"].map((key) => [key, (p.coursework[key] || []).join("\n")])),
    });
    setErr("");
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const gpaWeighted = String(draft.gpaWeighted).trim();
      const gpaUnweighted = String(draft.gpaUnweighted).trim();
      const sat = String(draft.sat).trim();
      const gradYear = String(draft.gradYear).trim();
      const validNumber = (value, min, max) => /^\d+(?:\.\d+)?$/.test(value) && Number(value) >= min && Number(value) <= max;
      if (gpaUnweighted && !validNumber(gpaUnweighted, 0, 4)) throw new Error("Unweighted GPA must be a number from 0 to 4, or left blank.");
      if (gpaWeighted && !validNumber(gpaWeighted, 0, 6)) throw new Error("Weighted GPA must be a number from 0 to 6, or left blank.");
      if (sat && (!/^\d+$/.test(sat) || !validNumber(sat, 400, 1600))) throw new Error("SAT must be a whole number from 400 to 1600, or left blank.");
      if (gradYear && (!/^\d{4}$/.test(gradYear) || Number(gradYear) < 1900 || Number(gradYear) > 2100)) throw new Error("Graduation year must be a four-digit year from 1900 to 2100, or left blank.");
      if (draft.activities.length > MAX_ACT || draft.honors.length > MAX_HON) throw new Error(`Keep up to ${MAX_ACT} activities and ${MAX_HON} honors.`);
      for (const [index, activity] of draft.activities.entries()) {
        if (!activity.name.trim()) throw new Error(`Give activity ${index + 1} a name, or remove it.`);
        if ((activity.desc || "").length > DESC_LIMIT) throw new Error(`Shorten activity ${index + 1}'s description to ${DESC_LIMIT} characters.`);
        for (const [key, label, max] of [["hpw", "Hours per week", 168], ["wpy", "Weeks per year", 52]]) {
          const value = String(activity[key] ?? "").trim();
          if (value && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > max)) throw new Error(`Activity ${index + 1}: ${label} must be between 0 and ${max}.`);
        }
      }
      draft.honors.forEach((honor, index) => {
        if (!honor.title.trim()) throw new Error(`Give honor ${index + 1} a title, or remove it.`);
      });
      draft.aps.forEach((ap, index) => {
        if (!ap.course.trim() || !/^[1-5]$/.test(String(ap.score))) throw new Error(`AP exam ${index + 1} needs a course name and a score from 1 to 5. Put planned exams in coursework.`);
      });
      const activities = draft.activities.map((activity, index) => ({ ...activity, rank: index + 1 }));
      const honors = draft.honors;
      const ws = await window.cfApi.patch({
        applicant: {
          name: draft.name,
          cycle: draft.cycle,
          year: draft.year,
          gpaWeighted: gpaWeighted || "—",
          gpaUnweighted: gpaUnweighted || "—",
          sat: sat || "—",
          satNote: draft.satNote,
          awards: honors.length,
        },
        profile: {
          intended: draft.intended,
          hs: draft.hs,
          gradYear,
          location: draft.location,
          counselor: draft.counselor,
          residency: draft.residency,
          testing: { sat: sat || "—", satNote: draft.satNote, aps: draft.aps.map((ap) => ({ ...ap, score: String(ap.score) })) },
          coursework: Object.fromEntries(Object.entries(draft.coursework).map(([key, value]) => [key, value.split("\n").map((course) => course.trim()).filter(Boolean)])),
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

  const updateItem = (key, index, field, value) => setDraft((d) => ({ ...d, [key]: d[key].map((item, i) => i === index ? { ...item, [field]: value } : item) }));
  const removeItem = (key, index) => setDraft((d) => ({ ...d, [key]: d[key].filter((_, i) => i !== index) }));
  const moveActivity = (index, direction) => setDraft((d) => {
    const activities = [...d.activities];
    [activities[index], activities[index + direction]] = [activities[index + direction], activities[index]];
    return { ...d, activities };
  });

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

      {err ? <div role="alert" style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--error) 12%, transparent)", color: "var(--error)", fontSize: 13 }}>{err}</div> : null}

      {editing && draft ? (
        <div style={{ display: "grid", gap: 16, marginBottom: 28 }}>
          <Panel title="Identity & academics">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              <Input label="Name" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
              <Input label="Cycle" value={draft.cycle} onChange={(v) => setDraft((d) => ({ ...d, cycle: v }))} placeholder="Fall 2027" />
              <Input label="Year label" value={draft.year} onChange={(v) => setDraft((d) => ({ ...d, year: v }))} />
              <Input label="GPA weighted" inputMode="decimal" placeholder="4.25" hint="Optional · 0–6 scale" value={draft.gpaWeighted} onChange={(v) => setDraft((d) => ({ ...d, gpaWeighted: v }))} />
              <Input label="GPA unweighted" inputMode="decimal" placeholder="3.80" hint="Optional · 0–4 scale" value={draft.gpaUnweighted} onChange={(v) => setDraft((d) => ({ ...d, gpaUnweighted: v }))} />
              <Input label="SAT" inputMode="numeric" placeholder="1400" hint="Optional · Whole number, 400–1600" value={draft.sat} onChange={(v) => setDraft((d) => ({ ...d, sat: v }))} />
              <Input label="SAT note" value={draft.satNote} onChange={(v) => setDraft((d) => ({ ...d, satNote: v }))} />
              <Input label="Intended major" value={draft.intended} onChange={(v) => setDraft((d) => ({ ...d, intended: v }))} />
              <Input label="High school" value={draft.hs} onChange={(v) => setDraft((d) => ({ ...d, hs: v }))} />
              <Input label="Grad year" inputMode="numeric" placeholder="2027" hint="Optional · Four digits, 1900–2100" value={String(draft.gradYear)} onChange={(v) => setDraft((d) => ({ ...d, gradYear: v }))} />
              <Input label="Location" value={draft.location} onChange={(v) => setDraft((d) => ({ ...d, location: v }))} />
              <Input label="Counselor" value={draft.counselor} onChange={(v) => setDraft((d) => ({ ...d, counselor: v }))} />
              <Input label="Residency" value={draft.residency} onChange={(v) => setDraft((d) => ({ ...d, residency: v }))} />
            </div>
          </Panel>
          <Panel title={`Activities · ${draft.activities.length}/${MAX_ACT}`}>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>Start with what matters most to you. Use the arrows to set your application order.</p>
            <div style={{ display: "grid", gap: 16 }}>
              {draft.activities.map((activity, index) => <EditorItem key={index} title={`Activity ${index + 1}`} onRemove={() => removeItem("activities", index)} actions={<>
                <Button size="sm" variant="secondary" disabled={index === 0} onClick={() => moveActivity(index, -1)}>Move up</Button>
                <Button size="sm" variant="secondary" disabled={index === draft.activities.length - 1} onClick={() => moveActivity(index, 1)}>Move down</Button>
              </>}>
                <div style={editorGrid}>
                  {[["name", "Activity name"], ["type", "Activity type"], ["org", "Organization"], ["role", "Your role"], ["years", "Grades / years participated"]].map(([key, label]) => <Input key={key} label={label} value={activity[key]} onChange={(value) => updateItem("activities", index, key, value)} />)}
                  <Input label="Hours per week" type="number" min="0" max="168" step="any" value={activity.hpw} onChange={(value) => updateItem("activities", index, "hpw", value)} />
                  <Input label="Weeks per year" type="number" min="0" max="52" step="any" value={activity.wpy} onChange={(value) => updateItem("activities", index, "wpy", value)} />
                </div>
                <TextInput label="Short description" value={activity.desc} onChange={(value) => updateItem("activities", index, "desc", value)} hint={`${(activity.desc || "").length}/${DESC_LIMIT} characters for Common App`} />
                <TextInput label="Additional accomplishments" value={(activity.bullets || []).join("\n")} onChange={(value) => updateItem("activities", index, "bullets", value.split("\n"))} hint="One accomplishment per line. Keep details here while refining your short description." />
                <label style={{ fontSize: 13, color: "var(--body)" }}><input type="checkbox" checked={!!activity.college} onChange={(e) => updateItem("activities", index, "college", e.target.checked)} /> I plan to continue this in college</label>
              </EditorItem>)}
              <div><Button size="sm" variant="secondary" disabled={draft.activities.length >= MAX_ACT} onClick={() => setDraft((d) => ({ ...d, activities: [...d.activities, { name: "", type: "", role: "", desc: "", bullets: [] }] }))}>+ Add activity</Button></div>
            </div>
          </Panel>
          <Panel title={`Honors & awards · ${draft.honors.length}/${MAX_HON}`}>
            <div style={{ display: "grid", gap: 16 }}>
              {draft.honors.map((honor, index) => <EditorItem key={index} title={`Honor ${index + 1}`} onRemove={() => removeItem("honors", index)}>
                <div style={editorGrid}>
                  <Input label="Award or honor title" value={honor.title} onChange={(value) => updateItem("honors", index, "title", value)} />
                  <Input label="Recognition level" placeholder="School, regional, state, national…" value={honor.level} onChange={(value) => updateItem("honors", index, "level", value)} />
                  <Input label="Year / grade received" value={honor.year} onChange={(value) => updateItem("honors", index, "year", value)} />
                </div>
                <label style={{ fontSize: 13, color: "var(--body)" }}><input type="checkbox" checked={!!honor.top} onChange={(e) => updateItem("honors", index, "top", e.target.checked)} /> Highlight this honor</label>
              </EditorItem>)}
              <div><Button size="sm" variant="secondary" disabled={draft.honors.length >= MAX_HON} onClick={() => setDraft((d) => ({ ...d, honors: [...d.honors, { title: "", level: "", year: "", top: false }] }))}>+ Add honor</Button></div>
            </div>
          </Panel>
          <Panel title="AP exam scores">
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>Add completed exams here. Put planned AP classes in coursework below.</p>
            <div style={{ display: "grid", gap: 16 }}>
              {draft.aps.map((ap, index) => <EditorItem key={index} title={`AP exam ${index + 1}`} onRemove={() => removeItem("aps", index)}>
                <div style={editorGrid}>
                  <Input label="AP course" value={ap.course} onChange={(value) => updateItem("aps", index, "course", value)} placeholder="Calculus AB" />
                  <Input label="Score (1–5)" type="number" min="1" max="5" step="1" value={ap.score} onChange={(value) => updateItem("aps", index, "score", value)} />
                </div>
              </EditorItem>)}
              <div><Button size="sm" variant="secondary" onClick={() => setDraft((d) => ({ ...d, aps: [...d.aps, { course: "", score: "" }] }))}>+ Add AP score</Button></div>
            </div>
          </Panel>
          <Panel title="Coursework">
            <div style={editorGrid}>
              {[["honors", "Honors courses"], ["aps", "AP courses"], ["senior", "Senior year courses (planned)"]].map(([key, label]) => <TextInput key={key} label={label} value={draft.coursework[key]} hint="One course per line" onChange={(value) => setDraft((d) => ({ ...d, coursework: { ...d.coursework, [key]: value } }))} />)}
            </div>
          </Panel>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
            {err ? <span role="alert" style={{ color: "var(--error)", fontSize: 13 }}>{err}</span> : <span style={{ color: "var(--muted)", fontSize: 13 }}>Changes are saved when you choose Save profile.</span>}
          </div>
        </div>
      ) : null}

      <section className="cf-grid-4 cf-profile-stats cf-nums" style={{ marginBottom: 24 }}>
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
