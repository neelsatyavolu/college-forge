const { Card, Badge, SectionLabel, Button } = window.CollegeForgeDesignSystem_e95e63;

function prettyDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Overview({ data, onNavigate, onAsk }) {
  const { applicant, ed, criticalDates, colleges } = data;
  const reaches = colleges.filter((c) => c.tier === "reach");
  const targets = colleges.filter((c) => c.tier === "target");
  const safeties = colleges.filter((c) => c.tier === "safety");
  const tiers = [
    { label: "Reaches", items: reaches },
    { label: "Targets", items: targets },
    { label: "Safeties", items: safeties },
  ];
  const snapshot = [
    { label: "Weighted GPA", value: applicant.gpaWeighted || "—", hint: "school formula" },
    { label: "Unweighted GPA", value: applicant.gpaUnweighted || "—", hint: "4.0 scale" },
    { label: "SAT", value: applicant.sat || "—", hint: applicant.satNote || "from testing" },
    { label: "Awards", value: String(applicant.awards ?? 0), hint: "parsed from uploads" },
  ];
  const hasCycle = Boolean(applicant.cycle);
  const hasYear = Boolean(applicant.year);

  return (
    <div className="cf-page">
      {/* Hero */}
      <section style={{ paddingBottom: 32, marginBottom: 32, borderBottom: "1px solid var(--hairline)" }}>
        {(hasCycle || hasYear) ? (
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            {hasCycle ? <Badge variant="coral" uppercase>Cycle {applicant.cycle}</Badge> : null}
            {hasYear ? <Badge variant="cream" uppercase>{applicant.year}</Badge> : null}
          </div>
        ) : null}
        <div className="cf-grid-hero">
          <h1 className="cf-page-title">
            Your college<br />applications.
          </h1>
          <p className="cf-page-lede" style={{ paddingBottom: 8, margin: 0 }}>
            Everything parsed from your uploads and kept in sync. Ask the copilot to change anything, or use the quick buttons.
          </p>
        </div>
      </section>

      {/* Snapshot + ED priority */}
      <section className="cf-grid-snapshot" style={{ marginBottom: 56 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SectionLabel>Snapshot</SectionLabel>
          {snapshot.map((s) => (
            <div key={s.label} style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "baseline" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: "var(--muted-soft)" }}>{s.hint}</div>
              </div>
              <div className="cf-display cf-nums" style={{ fontSize: 32, lineHeight: 1, letterSpacing: "-0.5px", color: "var(--ink)" }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {ed ? (
          <Card variant="coral" style={{ padding: 28 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SectionLabel style={{ color: "rgba(255,255,255,0.85)", marginBottom: 10 }}>Priority — Early Decision (Binding)</SectionLabel>
                <h2 className="cf-display" style={{ margin: "0 0 10px", fontSize: "clamp(24px, 3vw, 32px)", lineHeight: 1.15, letterSpacing: "-0.5px", textWrap: "balance" }}>{ed.school}</h2>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, opacity: 0.9 }}>{ed.reason}</p>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div className="cf-display cf-nums" style={{ fontSize: 56, lineHeight: 1, letterSpacing: "-1.5px" }}>{ed.daysLeft}</div>
                <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.5px", color: "rgba(255,255,255,0.85)", marginTop: 4 }}>days to ED</div>
              </div>
            </div>
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, opacity: 0.9 }}>ED deadline <strong style={{ fontWeight: 500 }}>{ed.deadline ? prettyDate(ed.deadline) : "—"}</strong></span>
              <Button variant="onColor" size="sm" arrow onClick={() => onNavigate("planner")}>Open the plan</Button>
            </div>
          </Card>
          ) : null}

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
              <SectionLabel>Critical dates</SectionLabel>
              <a href="#planner" onClick={(e) => { e.preventDefault(); onNavigate("planner"); }} style={{ fontSize: 13, fontWeight: 500 }}>Full timeline →</a>
            </div>
            <div style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)" }}>
              {criticalDates.length === 0 ? (
                <div className="cf-empty-soft" style={{ margin: 0, border: "none", borderRadius: "var(--radius-lg)" }}>No dates yet — add deadlines via the copilot.</div>
              ) : criticalDates.map((m, i) => (
                <div key={m.label} style={{ display: "grid", gridTemplateColumns: "minmax(88px, 110px) 1fr", gap: 16, alignItems: "baseline", padding: "14px 20px", borderTop: i === 0 ? "none" : "1px solid var(--hairline)" }}>
                  <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)" }}>{m.date}</div>
                  <div>
                    <div className="cf-display" style={{ fontSize: 17, lineHeight: 1.3, color: "var(--ink)", marginBottom: 2 }}>{m.label}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>{m.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tier strip */}
      <section style={{ marginBottom: 56 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
          <SectionLabel>School list — {colleges.length} total</SectionLabel>
          <a href="#shortlist" onClick={(e) => { e.preventDefault(); onNavigate("shortlist"); }} style={{ fontSize: 13, fontWeight: 500 }}>Compare all →</a>
        </div>
        <div className="cf-grid-3">
          {tiers.map((t) => (
            <button key={t.label} type="button" onClick={() => onNavigate("shortlist")} className="cf-press"
              style={{ textAlign: "left", cursor: "pointer", background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: 20 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)" }}>{t.label}</span>
                <span className="cf-display cf-nums" style={{ fontSize: 36, lineHeight: 1, letterSpacing: "-0.5px", color: "var(--ink)" }}>{t.items.length}</span>
              </div>
              {t.items.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--muted-soft)" }}>None yet</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {t.items.map((s) => (
                    <span key={s.slug} style={{ fontSize: 12, padding: "2px 8px", background: "var(--surface-card)", borderRadius: "var(--radius-xs)", color: "var(--ink)" }}>{s.short}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Strategy callout */}
      <section>
        <Card variant="dark" style={{ padding: "clamp(24px, 4vw, 32px)" }}>
          <SectionLabel style={{ color: "rgba(250,249,245,0.7)", marginBottom: 12 }}>Copilot summary</SectionLabel>
          <h2 className="cf-display" style={{ margin: "0 0 12px", fontSize: "clamp(24px, 3vw, 32px)", lineHeight: 1.15, letterSpacing: "-0.5px", textWrap: "balance" }}>Apply where the department fits. Let the AI keep it current.</h2>
          <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.55, opacity: 0.9, maxWidth: 760, textWrap: "pretty" }}>
            Upload a transcript, a resume, or an award list and College Forge parses it into your hub. The copilot can reshape your school list, rewrite a supplement plan, or answer any deadline question — and every change stays in sync.
          </p>
          <Button variant="onColor" onClick={onAsk}>Ask the copilot ✱</Button>
        </Card>
      </section>
    </div>
  );
}
window.Overview = Overview;
