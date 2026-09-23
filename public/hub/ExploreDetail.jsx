const { Badge, VerdictBadge, Button } = window.CollegeForgeDesignSystem_e95e63;

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

window.collegeInitials = initialsOf;

function Section({ title, note, children }) {
  return (
    <section className="cf-explore-section">
      <div className="cf-section-heading">
        <h3>{title}</h3>
        {note ? <span>{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Label/value pairs in the workspace's metric style; missing values read "—". */
function Stats({ items, compact }) {
  return (
    <dl className={"cf-explore-stats" + (compact ? " cf-explore-stats--compact" : "")}>
      {items.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{dash(value)}</dd></div>
      ))}
    </dl>
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

const NoteBox = ({ children }) => <p className="cf-empty-soft" style={{ margin: 0, fontSize: 13 }}>{children}</p>;

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

/** One row of the "At a glance" card; skipped when the value is unknown. */
const Glance = ({ label, children }) => (children ? <div><dt>{label}</dt><dd>{children}</dd></div> : null);

function ExploreDetail({ c, detail, savedCollege, loading, edition, favorite, onToggleFavorite, onAdd, onRemove, onList, busy }) {
  // `c` is the light list row (instant); `detail` is the full record (async).
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const d = { ...c, ...detail };
  for (const key of ["tier", "verdict", "plans", "deadlines", "transfer"]) {
    if (savedCollege?.[key]) d[key] = savedCollege[key];
  }
  const setting = d.setting ? d.setting[0].toUpperCase() + d.setting.slice(1) : null;
  const place = d.location ? d.location.split(" · ")[0] : null;
  const programs = (detail && detail.programs) || [];
  const ranked = typeof d.rank === "number" && d.rank > 0;
  const eyebrow = ranked ? `U.S. News ${edition ? edition + " " : ""}#${d.rank} · National Universities` : "U.S. Dept. of Education data";
  const hasPlans = d.plans && d.plans.length > 0;
  const hasDeadlines = d.deadlines && d.deadlines.length > 0;

  return (
    <article className="cf-explore-page">
      <window.CollegePhoto name={d.name} photo={d.photo} className="cf-explore-page__hero" />

      <header className="cf-explore-page__head">
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div className="cf-eyebrow" style={{ textTransform: "uppercase" }}>{eyebrow}</div>
          <h1 className="cf-explore-page__title">{d.name}</h1>
          <p className="cf-explore-page__place">{[place, setting ? `${setting} campus` : null, d.ownership].filter(Boolean).join(" · ")}</p>
          {d.verdict || d.tier || (d.tags || []).length ? (
            <div className="cf-explore-badges">
              {d.verdict ? <VerdictBadge tone={d.verdict.tone}>{d.verdict.label}</VerdictBadge> : null}
              {d.tier ? <Badge variant="cream">{d.tier === "safety" ? "Likely" : d.tier[0].toUpperCase() + d.tier.slice(1)}</Badge> : null}
              {(d.tags || []).map((t, i) => <Badge key={i} variant="cream">{t.label}</Badge>)}
            </div>
          ) : null}
        </div>
        <div className="cf-explore-actions">
          {onList ? (
            <Button variant="secondary" onClick={() => setConfirmRemove(true)} disabled={busy}>Remove from shortlist</Button>
          ) : (
            <Button onClick={() => onAdd(d)} disabled={busy}>{busy ? "Saving…" : "Add to shortlist"}</Button>
          )}
          <Button variant="secondary" onClick={onToggleFavorite} aria-pressed={favorite}>{favorite ? "★ Favorited" : "☆ Favorite"}</Button>
        </div>
      </header>

      {onList && confirmRemove ? (
        <div className="cf-explore-confirm">
          <p>Remove this school from your shortlist? Your saved essay drafts will remain.</p>
          <div className="cf-explore-actions">
            <Button size="sm" disabled={busy} onClick={() => onRemove(d)}>{busy ? "Removing…" : "Confirm removal"}</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep school</Button>
          </div>
        </div>
      ) : null}

      <Stats items={[
        ["Admit rate", d.admit],
        ["SAT middle 50%", d.satRange],
        ["ACT middle 50%", d.act],
        ["Average GPA", d.gpa],
        ["Undergraduates", d.size],
      ]} />

      <div className="cf-explore-page__layout">
        <aside className="cf-explore-glance" aria-label="At a glance">
          <h2>At a glance</h2>
          <dl>
            <Glance label="Location">{place}</Glance>
            <Glance label="Campus">{setting}</Glance>
            <Glance label="Type">{d.ownership}</Glance>
            <Glance label="SAT/ACT policy">{d.testPolicy}</Glance>
            <Glance label="Pell grant recipients">{d.pellRate}</Glance>
            <Glance label="Average net price">{d.netPrice}</Glance>
          </dl>
          <div className="cf-explore-glance__links">
            {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer">College website ↗</a> : null}
            {d.priceCalcUrl ? <a href={d.priceCalcUrl} target="_blank" rel="noopener noreferrer">Net price calculator ↗</a> : null}
          </div>
        </aside>

        <div className="cf-explore-page__main">
          <Section title="Cost & outcomes" note={loading ? "Loading…" : "U.S. Dept. of Education"}>
            <Stats compact items={[
              ["Average net price", d.netPrice],
              ["Cost of attendance", d.coa],
              ["Tuition, in-state", d.tuitionIn],
              ["Tuition, out-of-state", d.tuitionOut],
              ["4-year graduation", d.grad4],
              ["6-year graduation", d.grad6],
              ["Freshman retention", d.retention],
              ["Median earnings, 10 yrs", d.earnings],
            ]} />
            <p className="cf-explore-note">Average net price is what families paid after grants, not your aid offer. Use the college’s net price calculator for an estimate.</p>
          </Section>

          <Section title="Admission plans & deadlines" note={hasPlans ? `${d.plans.length} plans` : null}>
            {hasPlans || hasDeadlines ? (
              <div style={{ display: "grid", gap: 12 }}>
                {hasPlans ? <Table head={[{ label: "Plan" }, { label: "Admit rate", right: true, mono: true }]} rows={d.plans.map((p) => [p.plan, p.rate])} /> : null}
                {hasDeadlines ? <Table head={[{ label: "Plan" }, { label: "Deadline", mono: true }]} rows={d.deadlines.map((x) => [x.plan, x.date])} /> : null}
              </div>
            ) : (
              <NoteBox>
                Plan-specific admit rates and deadlines aren’t in the federal dataset. The overall admit rate ({dash(d.admit)}) describes a past applicant pool, not your odds. Confirm plans and deadlines on the college’s admissions website.
              </NoteBox>
            )}
          </Section>

          <Section title="Schools & programs" note={programs.length ? `${programs.length} bachelor’s programs` : loading ? "Loading…" : null}>
            {loading && !programs.length ? <NoteBox>Loading programs…</NoteBox> : <Programs programs={programs} />}
          </Section>

          <Section title="Field-of-study earnings" note={programs.length ? "Median 4 yrs after completion" : null}>
            {loading && !programs.length ? <NoteBox>Loading…</NoteBox> : <FieldEarnings programs={programs} />}
          </Section>

          <Section title="Internal transfer policy">
            {d.transfer ? (
              <p style={{ margin: 0, fontSize: 14, color: "var(--ink)", lineHeight: 1.6 }}>{d.transfer}</p>
            ) : (
              <NoteBox>Check {d.short || d.name}’s official department and admissions pages for restrictions on changing majors or colleges.</NoteBox>
            )}
          </Section>

          <p className="cf-explore-footnote">A dash means the data is unavailable. Verify testing policies and deadlines for your application year.</p>
        </div>
      </div>
    </article>
  );
}
window.ExploreDetail = ExploreDetail;
