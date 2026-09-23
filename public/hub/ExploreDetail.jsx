const { Tile, Badge, VerdictBadge, Button } = window.CollegeForgeDesignSystem_e95e63;

// Missing Scorecard fields render as em dash — never a raw 0/empty string.
const dash = (v) =>
  v === undefined || v === null || v === ""
    ? "—"
    : v;

// Matches initialsOf() in the design bundle: split on any non-letter and skip
// connector words, so "University of California-Berkeley" reads "UC", not "UO".
const STOP_WORDS = { of: 1, the: 1, at: 1, and: 1, for: 1, in: 1, a: 1 };
function initialsOf(name) {
  const all = String(name).replace(/[^A-Za-z]+/g, " ").split(/\s+/).filter(Boolean);
  const words = all.filter((w) => !STOP_WORDS[w.toLowerCase()]);
  return (words.length ? words : all).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function Section({ title, note, children }) {
  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <h3 className="cf-display" style={{ margin: 0, fontSize: 16, color: "var(--ink)" }}>{title}</h3>
        {note ? <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows }) {
  return (
    <div style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--hairline)", overflow: "hidden" }}>
      <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
        <thead><tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--hairline)" }}>
          {head.map((h, i) => (
            <th key={i} style={{ padding: "8px 12px", fontWeight: 500, textAlign: h.right ? "right" : "left" }}>{h.label}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} style={{ borderTop: i === 0 ? "none" : "1px solid var(--hairline-soft)" }}>
              {cells.map((c, j) => (
                <td key={j} style={{ padding: "8px 12px", color: "var(--ink)", textAlign: head[j].right ? "right" : "left", fontFamily: head[j].mono ? "var(--font-mono)" : "var(--font-body)" }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const NoteBox = ({ children }) => (
  <div style={{ borderRadius: "var(--radius-md)", border: "1px dashed var(--hairline)", background: "var(--surface-soft)", padding: 12 }}>
    <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>{children}</p>
  </div>
);

/** Schools & programs — bachelor's programs grouped by field-of-study area. */
function Programs({ programs }) {
  const [openArea, setOpenArea] = React.useState(null);
  const areas = React.useMemo(() => {
    const by = new Map();
    for (const p of programs) {
      if (!by.has(p.area)) by.set(p.area, []);
      by.get(p.area).push(p);
    }
    return [...by.entries()]
      .map(([area, items]) => ({ area, items, awards: items.reduce((n, i) => n + (i.awards || 0), 0) }))
      .sort((a, b) => b.awards - a.awards);
  }, [programs]);

  if (!programs.length) return <NoteBox>No bachelor’s program data published for this school.</NoteBox>;

  return (
    <div style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--hairline)", overflow: "hidden" }}>
      {areas.map((a, i) => {
        const open = openArea === a.area;
        return (
          <div key={a.area} style={{ borderTop: i === 0 ? "none" : "1px solid var(--hairline-soft)" }}>
            <button type="button" aria-expanded={open} onClick={() => setOpenArea(open ? null : a.area)}
              style={{ width: "100%", textAlign: "left", cursor: "pointer", background: open ? "var(--surface-soft)" : "transparent", border: "none", padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
              <span aria-hidden style={{ color: "var(--muted-soft)", transform: open ? "rotate(90deg)" : "none", transition: "transform 140ms ease", fontSize: 12 }}>›</span>
              <span style={{ flex: 1, fontSize: 13.5, color: "var(--ink)" }}>{a.area}</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{a.items.length} program{a.items.length === 1 ? "" : "s"}</span>
              {a.awards ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted-soft)" }}>{a.awards.toLocaleString()} awarded</span> : null}
            </button>
            {open ? (
              <div style={{ padding: "0 12px 10px 34px", display: "flex", flexDirection: "column", gap: 4 }}>
                {a.items.map((p) => (
                  <div key={p.code} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
                    <span style={{ color: "var(--body)" }}>{p.title}</span>
                    <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted-soft)" }}>
                      {p.awards ? `${p.awards.toLocaleString()} · ` : ""}{p.code}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Field-of-study earnings — this school's median vs the national median. */
function FieldEarnings({ programs }) {
  const rows = React.useMemo(
    () => programs.filter((p) => typeof p.earnings4 === "number").sort((a, b) => b.earnings4 - a.earnings4).slice(0, 12),
    [programs]
  );
  if (!rows.length) {
    return <NoteBox>No field-of-study earnings published for this school’s bachelor’s programs.</NoteBox>;
  }
  const max = Math.max(...rows.map((r) => Math.max(r.earnings4, r.national4 || 0)));
  const money = (n) => `$${Math.round(n).toLocaleString()}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((p) => {
        const beats = typeof p.national4 === "number" && p.earnings4 > p.national4;
        return (
          <div key={p.code}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 3 }}>
              <span style={{ fontSize: 13, color: "var(--ink)", minWidth: 0 }}>{p.title}</span>
              <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--ink)" }}>{money(p.earnings4)}</span>
            </div>
            <div style={{ position: "relative", height: 6, borderRadius: "var(--radius-pill)", background: "var(--surface-cream-strong)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(p.earnings4 / max) * 100}%`, background: beats ? "var(--accent-teal)" : "var(--coral)", borderRadius: "var(--radius-pill)" }} />
            </div>
            {typeof p.national4 === "number" ? (
              <div style={{ marginTop: 2, fontSize: 11.5, color: "var(--muted-soft)" }}>
                national median {money(p.national4)} · {beats ? "+" : ""}{Math.round(((p.earnings4 - p.national4) / p.national4) * 100)}%
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ExploreDetail({ c, detail, savedCollege, loading, favorite, onToggleFavorite, onAdd, onRemove, onList, busy }) {
  // `c` is the light search row (instant); `detail` is the full record (async).
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [photoFailed, setPhotoFailed] = React.useState(false);
  const d = { ...c, ...detail };
  for (const key of ["tier", "verdict", "plans", "deadlines", "transfer"]) {
    if (savedCollege?.[key]) d[key] = savedCollege[key];
  }
  const initials = initialsOf(d.name);
  const setting = d.setting ? d.setting[0].toUpperCase() + d.setting.slice(1) : null;
  const programs = (detail && detail.programs) || [];

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "clamp(14px, 3vw, 24px)", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "1px", color: "var(--muted)", fontWeight: 500 }}>
            {[
              typeof d.rank === "number" && d.rank > 0 ? `U.S. News #${d.rank}` : null,
              d.ownership,
            ].filter(Boolean).join(" · ") || "US Dept. of Education"}
          </div>
          <h2 className="cf-display" style={{ margin: "2px 0 0", fontSize: "clamp(24px, 3vw, 32px)", lineHeight: 1.1, color: "var(--ink)", textWrap: "balance" }}>{d.name}</h2>
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {d.verdict ? <VerdictBadge tone={d.verdict.tone}>{d.verdict.label}</VerdictBadge> : null}
            {d.tier ? <Badge variant="cream">{d.tier === "safety" ? "Likely" : d.tier[0].toUpperCase() + d.tier.slice(1)}</Badge> : null}
            {(d.tags || []).map((t, i) => <Badge key={i} variant="cream">{t.label}</Badge>)}
            {d.url ? (
              <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5 }}>Website ↗</a>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", flexShrink: 0 }}>
          {onList ? (
            <Button size="sm" variant="secondary" onClick={() => setConfirmRemove(true)} disabled={busy}>Remove from list</Button>
          ) : (
            <Button size="sm" onClick={() => onAdd(d)} disabled={busy}>{busy ? "…" : "+ Add to my list"}</Button>
          )}
          <button type="button" onClick={onToggleFavorite} aria-pressed={favorite} className="cf-press"
            style={{ borderRadius: "var(--radius-pill)", border: "1px solid var(--hairline)", background: "var(--canvas)", padding: "8px 14px", minHeight: 36, fontSize: 13, cursor: "pointer", color: "var(--ink)" }}>
            {favorite ? "★ Favorited" : "☆ Favorite"}
          </button>
        </div>
      </div>

      {onList && confirmRemove ? <div style={{ marginTop: 12, padding: 12, background: "var(--surface-soft)", borderRadius: "var(--radius-sm)" }}>
        <p style={{ margin: "0 0 8px", fontSize: 13 }}>Remove this school from your list? Your saved essay drafts will remain.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Button size="sm" disabled={busy} onClick={() => onRemove(d)}>{busy ? "Removing…" : "Confirm removal"}</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep school</Button>
        </div>
      </div> : null}

      {/* Snapshot tiles + campus photo */}
      <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
        <div className="cf-nums" style={{ display: "grid", flex: "1 1 240px", minWidth: 0, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <Tile label="Location" value={dash(d.location ? d.location.split(" · ")[0] : null)} />
          <Tile label="Campus setting" value={dash(setting)} />
          <Tile label="Undergraduate size" value={dash(d.size)} />
          <Tile label="Overall admit rate" value={dash(d.admit)} />
          <Tile label="SAT (25–75%)" value={dash(d.satRange)} />
          <Tile label="ACT (25–75%)" value={dash(d.act)} />
          {typeof d.rank === "number" && d.rank > 0 ? (
            <Tile label="U.S. News rank" value={`#${d.rank}`} />
          ) : null}
          {d.gpa ? <Tile label="Avg GPA" value={dash(d.gpa)} /> : null}
        </div>
        <div className="cf-img-outline cf-campus-photo" style={{ flex: "0 0 auto", width: "min(280px, 100%)", minHeight: 160, aspectRatio: "4 / 3", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--hairline)" }}>
          {d.photo && !photoFailed ? <img src={d.photo} onError={() => setPhotoFailed(true)} alt="" style={{ height: "100%", width: "100%", objectFit: "cover", display: "block" }} />
            : <div style={{ height: "100%", minHeight: 160, display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--coral) 10%, transparent)", color: "var(--coral)", fontFamily: "var(--font-display)", fontSize: 42 }}>{initials}</div>}
        </div>
      </div>

      {d.testPolicy ? (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted)" }}>
          SAT/ACT policy: <strong style={{ color: "var(--ink)", fontWeight: 500 }}>{d.testPolicy}</strong>
          {d.pellRate ? <> · Pell recipients: <strong style={{ color: "var(--ink)", fontWeight: 500 }}>{d.pellRate}</strong></> : null}
        </div>
      ) : null}

      <Section title="Cost & outcomes" note={loading ? "loading…" : "US Dept. of Education"}>
        <div className="cf-nums" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <Tile label="Net price (avg)" value={dash(d.netPrice)} />
          <Tile label="Cost of attendance" value={dash(d.coa)} />
          <Tile label="Tuition (in-state)" value={dash(d.tuitionIn)} />
          <Tile label="Tuition (out-of-state)" value={dash(d.tuitionOut)} />
          <Tile label="Grad rate (4-yr)" value={dash(d.grad4)} />
          <Tile label="Grad rate (6-yr)" value={dash(d.grad6)} />
          <Tile label="Freshman retention" value={dash(d.retention)} />
          <Tile label="Median earnings (10yr)" value={dash(d.earnings)} />
        </div>
        {d.priceCalcUrl ? (
          <p style={{ margin: "8px 0 0", fontSize: 12.5 }}>
            <a href={d.priceCalcUrl} target="_blank" rel="noopener noreferrer">Net price calculator ↗</a>
          </p>
        ) : null}
      </Section>

      <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>A dash means data is unavailable. Average net price is not a personal aid estimate; use the college’s net price calculator. Verify testing policies for your application year.</p>

      <Section title="Admission rates by plan" note={d.plans && d.plans.length ? `${d.plans.length} plans` : null}>
        {d.plans && d.plans.length ? (
          <Table head={[{ label: "Plan" }, { label: "Admit rate", right: true, mono: true }]}
            rows={d.plans.map((p) => [p.plan, p.rate])} />
        ) : (
          <NoteBox>
            Plan-specific rates are not available here. The overall admission rate ({dash(d.admit)}) describes a past applicant pool, not your personal odds. Check the college’s admissions website for current details.
          </NoteBox>
        )}
      </Section>

      <Section title="Application deadlines">
        {d.deadlines && d.deadlines.length ? (
          <Table head={[{ label: "Plan" }, { label: "Deadline", mono: true }]}
            rows={d.deadlines.map((x) => [x.plan, x.date])} />
        ) : (
          <NoteBox>Deadlines are not available in the federal dataset. Confirm the year, application plan, and deadline on the college’s admissions website.</NoteBox>
        )}
      </Section>

      <Section title="Schools & programs" note={programs.length ? `${programs.length} bachelor’s programs` : loading ? "loading…" : null}>
        {loading && !programs.length ? <NoteBox>Loading programs…</NoteBox> : <Programs programs={programs} />}
      </Section>

      <Section title="Field-of-study earnings" note={programs.length ? "median 4 yrs after completion" : null}>
        {loading && !programs.length ? <NoteBox>Loading…</NoteBox> : <FieldEarnings programs={programs} />}
      </Section>

      <Section title="Internal transfer policy">
        {d.transfer ? (
          <div style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--hairline)", background: "var(--canvas)", padding: 12 }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--ink)", lineHeight: 1.5 }}>{d.transfer}</p>
          </div>
        ) : (
          <NoteBox>Check {d.short || d.name}’s official department and admissions pages for restrictions on changing majors or colleges.</NoteBox>
        )}
      </Section>
    </div>
  );
}
window.ExploreDetail = ExploreDetail;
