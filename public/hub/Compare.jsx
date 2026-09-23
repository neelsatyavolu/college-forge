const { Button, Badge } = window.CollegeForgeDesignSystem_e95e63;

const tierLabel = (tier) => ({ reach: "Reach", target: "Target", safety: "Likely" }[tier] || "Not assessed");

const ROWS = [
  { key: "tier", label: "Tier", get: (c) => tierLabel(c.tier) },
  { key: "admit", label: "Overall admit rate", get: (c) => c.admit || "—" },
  { key: "sat", label: "SAT range", get: (c) => c.satRange || "—" },
  { key: "gpa", label: "Avg GPA", get: (c) => c.gpa || "—" },
  { key: "size", label: "Size", get: (c) => c.size || "—" },
  { key: "setting", label: "Setting", get: (c) => c.setting || "—" },
  { key: "net", label: "Average net price", get: (c) => c.netPrice || "—" },
  { key: "coa", label: "Cost of attendance", get: (c) => c.coa || "—" },
  { key: "grad6", label: "6-yr grad rate", get: (c) => c.grad6 || "—" },
  { key: "grad4", label: "4-yr grad rate", get: (c) => c.grad4 || "—" },
  { key: "retention", label: "Retention", get: (c) => c.retention || "—" },
  { key: "earnings", label: "Median earnings (10 yr)", get: (c) => c.earnings || "—" },
  { key: "test", label: "Test policy", get: (c) => c.testPolicy || "—" },
  { key: "deadline", label: "Deadline", get: (c) => c.deadline || "—" },
  { key: "supp", label: "Supplements", get: (c) => c.supp || "—" },
  { key: "status", label: "Your status", get: (c, apps) => (apps[c.slug] && apps[c.slug].status) || "researching" },
  { key: "npc", label: "Net price calc", get: (c) => (c.priceCalcUrl ? "link" : "—"), link: (c) => c.priceCalcUrl },
];

function Compare({ data, onAsk }) {
  const colleges = data.colleges || [];
  const apps = data.applications || {};
  const [details, setDetails] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const [selected, setSelected] = React.useState(() => colleges.slice(0, 4).map((c) => c.slug));

  React.useEffect(() => {
    setSelected((prev) => {
      const still = prev.filter((s) => colleges.some((c) => c.slug === s));
      if (still.length) return still;
      return colleges.slice(0, 4).map((c) => c.slug);
    });
  }, [colleges.map((c) => c.slug).join(",")]);

  React.useEffect(() => {
    const pending = colleges.filter((college) => selected.includes(college.slug) && college.scorecardId && !details[college.scorecardId]);
    if (!pending.length) { setLoading(false); setLoadError(""); return; }
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    Promise.allSettled(pending.map(async (college) => {
      const response = await fetch(`/api/colleges/detail?id=${encodeURIComponent(college.scorecardId)}`, { credentials: "same-origin", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.success || !result.data) throw new Error("School details unavailable");
      if (!controller.signal.aborted) setDetails((previous) => ({ ...previous, [college.scorecardId]: result.data }));
    })).then((results) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (results.some((result) => result.status === "rejected")) setLoadError("Some school details could not load. Saved information is still shown.");
    });
    return () => controller.abort();
  }, [selected.join(","), colleges.map((college) => college.scorecardId).join(","), retry]);

  const toggle = (slug) => {
    setSelected((s) => {
      if (s.includes(slug)) return s.filter((x) => x !== slug);
      if (s.length >= 5) return s;
      return [...s, slug];
    });
  };

  const cols = selected.map((slug) => colleges.find((c) => c.slug === slug)).filter(Boolean).map((college) => ({
    ...college, ...details[college.scorecardId], slug: college.slug, tier: college.tier,
    deadline: college.deadline, supp: college.supp,
  }));

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Compare</h1>
          <p className="cf-page-lede">Compare up to five schools on your list. Federal statistics describe past student groups; admission rates are not your personal odds, and average net price is not an aid offer. A dash means data is unavailable.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onAsk}>Ask copilot ✱</Button>
      </header>

      {colleges.length < 2 ? (
        <div className="cf-empty">Add at least two schools to your list to compare them. <a href="#explore">Explore colleges →</a></div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>{selected.length} of 5 selected{selected.length === 5 ? " · Deselect a school to choose another." : " · Select schools below."}</p>
          <div role="group" aria-label="Schools to compare" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {colleges.map((c) => {
              const on = selected.includes(c.slug);
              return (
                <button key={c.slug} type="button" aria-pressed={on} disabled={!on && selected.length >= 5} onClick={() => toggle(c.slug)}
                  className="cf-press"
                  style={{
                    padding: "6px 12px", borderRadius: "var(--radius-pill)", fontSize: 13, cursor: !on && selected.length >= 5 ? "not-allowed" : "pointer", opacity: !on && selected.length >= 5 ? 0.5 : 1,
                    border: "1px solid " + (on ? "var(--coral)" : "var(--hairline)"),
                    background: on ? "color-mix(in srgb, var(--coral) 12%, transparent)" : "var(--canvas)",
                    color: "var(--ink)",
                  }}>
                  {c.name || c.short}
                </button>
              );
            })}
          </div>

          <div role="status" style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{loading ? "Loading current available school data…" : "Scroll across the table to see every selected school."}</div>
          {loadError ? <div role="alert" style={{ fontSize: 13, color: "var(--error)", marginBottom: 12 }}>{loadError} <Button variant="secondary" size="sm" onClick={() => setRetry((value) => value + 1)}>Retry details</Button></div> : null}
          {cols.length === 0 ? (
            <div className="cf-empty-soft">Select schools above to compare.</div>
          ) : (
            <div role="region" aria-label="College comparison table" tabIndex={0} style={{ maxWidth: "100%", overflowX: "auto", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                <thead>
                  <tr style={{ background: "var(--surface-soft)" }}>
                    <th scope="col" style={{ textAlign: "left", padding: "12px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", fontWeight: 600, position: "sticky", left: 0, background: "var(--surface-soft)" }}>Metric</th>
                    {cols.map((c) => (
                      <th scope="col" key={c.slug} style={{ textAlign: "left", padding: "12px 14px", fontSize: 14, color: "var(--ink)", fontWeight: 500, minWidth: 120 }}>
                        <div className="cf-display" style={{ fontSize: 18 }}>{c.name || c.short}</div>
                        {c.tier ? <Badge variant="cream" uppercase>{tierLabel(c.tier)}</Badge> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, ri) => (
                    <tr key={row.key} style={{ borderTop: "1px solid var(--hairline-soft)", background: ri % 2 ? "var(--surface-soft)" : "var(--canvas)" }}>
                      <th scope="row" style={{ textAlign: "left", padding: "10px 14px", fontSize: 12, fontWeight: 500, color: "var(--muted)", position: "sticky", left: 0, background: "inherit" }}>{row.label}</th>
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
