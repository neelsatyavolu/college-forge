const { Button, Badge } = window.CollegeForgeDesignSystem_e95e63;

const ROWS = [
  { key: "tier", label: "Tier", get: (c) => c.tier || "—" },
  { key: "admit", label: "Admit rate", get: (c) => c.admit || "—" },
  { key: "sat", label: "SAT range", get: (c) => c.satRange || "—" },
  { key: "gpa", label: "Avg GPA", get: (c) => c.gpa || "—" },
  { key: "size", label: "Size", get: (c) => c.size || "—" },
  { key: "setting", label: "Setting", get: (c) => c.setting || "—" },
  { key: "net", label: "Net price", get: (c) => c.netPrice || "—" },
  { key: "coa", label: "Cost of attendance", get: (c) => c.coa || "—" },
  { key: "grad6", label: "6-yr grad rate", get: (c) => c.grad6 || "—" },
  { key: "grad4", label: "4-yr grad rate", get: (c) => c.grad4 || "—" },
  { key: "retention", label: "Retention", get: (c) => c.retention || "—" },
  { key: "earnings", label: "Median earnings", get: (c) => c.earnings || "—" },
  { key: "test", label: "Test policy", get: (c) => c.testPolicy || "—" },
  { key: "deadline", label: "Deadline", get: (c) => c.deadline || "—" },
  { key: "supp", label: "Supplements", get: (c) => c.supp || "—" },
  { key: "status", label: "Your status", get: (c, apps) => (apps[c.slug] && apps[c.slug].status) || "researching" },
  { key: "npc", label: "Net price calc", get: (c) => (c.priceCalcUrl ? "link" : "—"), link: (c) => c.priceCalcUrl },
];

function Compare({ data, onAsk }) {
  const colleges = data.colleges || [];
  const apps = data.applications || {};
  const [selected, setSelected] = React.useState(() => colleges.slice(0, 4).map((c) => c.slug));

  React.useEffect(() => {
    setSelected((prev) => {
      const still = prev.filter((s) => colleges.some((c) => c.slug === s));
      if (still.length) return still;
      return colleges.slice(0, 4).map((c) => c.slug);
    });
  }, [colleges.map((c) => c.slug).join(",")]);

  const toggle = (slug) => {
    setSelected((s) => {
      if (s.includes(slug)) return s.filter((x) => x !== slug);
      if (s.length >= 5) return s;
      return [...s, slug];
    });
  };

  const cols = selected.map((slug) => colleges.find((c) => c.slug === slug)).filter(Boolean);

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Compare</h1>
          <p className="cf-page-lede">Side-by-side view of schools on your list (up to 5). Stats come from College Scorecard and your hub data — treat as research, not a guarantee.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onAsk}>Ask copilot ✱</Button>
      </header>

      {colleges.length < 2 ? (
        <div className="cf-empty">Add at least two schools to your list to compare them.</div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
            {colleges.map((c) => {
              const on = selected.includes(c.slug);
              return (
                <button key={c.slug} type="button" onClick={() => toggle(c.slug)}
                  className="cf-press"
                  style={{
                    padding: "6px 12px", borderRadius: "var(--radius-pill)", fontSize: 13, cursor: "pointer",
                    border: "1px solid " + (on ? "var(--coral)" : "var(--hairline)"),
                    background: on ? "color-mix(in srgb, var(--coral) 12%, transparent)" : "var(--canvas)",
                    color: "var(--ink)",
                  }}>
                  {c.short || c.name}
                </button>
              );
            })}
          </div>

          {cols.length === 0 ? (
            <div className="cf-empty-soft">Select schools above to compare.</div>
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                <thead>
                  <tr style={{ background: "var(--surface-soft)" }}>
                    <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", fontWeight: 600, position: "sticky", left: 0, background: "var(--surface-soft)" }}>Metric</th>
                    {cols.map((c) => (
                      <th key={c.slug} style={{ textAlign: "left", padding: "12px 14px", fontSize: 14, color: "var(--ink)", fontWeight: 500, minWidth: 120 }}>
                        <div className="cf-display" style={{ fontSize: 18 }}>{c.short || c.name}</div>
                        {c.tier ? <Badge variant="cream" uppercase>{c.tier}</Badge> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, ri) => (
                    <tr key={row.key} style={{ borderTop: "1px solid var(--hairline-soft)", background: ri % 2 ? "var(--surface-soft)" : "var(--canvas)" }}>
                      <td style={{ padding: "10px 14px", fontSize: 12, fontWeight: 500, color: "var(--muted)", position: "sticky", left: 0, background: "inherit" }}>{row.label}</td>
                      {cols.map((c) => {
                        const val = row.get(c, apps);
                        const href = row.link && row.link(c);
                        return (
                          <td key={c.slug} style={{ padding: "10px 14px", fontSize: 13, color: "var(--ink)" }}>
                            {href && val === "link" ? (
                              <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--coral)" }}>Calculator →</a>
                            ) : val}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
window.Compare = Compare;
