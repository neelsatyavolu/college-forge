const { Button } = window.CollegeForgeDesignSystem_e95e63;

const MONTHS = { Nov: 10, Dec: 11, Jan: 0, Feb: 1, Mar: 2 };
// Build a sortable key from a "Mon D" string, wrapping Jan+ into the next year.
function orderKey(label) {
  const m = label.match(/([A-Za-z]{3})\s+(\d+)/);
  if (!m) return 9999;
  const mo = MONTHS[m[1]] ?? 6;
  const yearBump = mo <= 5 ? 12 : 0; // Nov/Dec first, then Jan..
  return (mo + yearBump) * 31 + parseInt(m[2], 10);
}

const PLAN_TONE = (plan) =>
  /Early Decision|ED/.test(plan) ? { bg: "var(--coral)", fg: "var(--on-primary)", label: "ED" }
  : /Restrictive|REA/.test(plan) ? { bg: "var(--accent-amber)", fg: "var(--ink)", label: "REA" }
  : /Early Action|EA/.test(plan) ? { bg: "var(--accent-teal)", fg: "var(--on-primary)", label: "EA" }
  : /Scholarship|priority/i.test(plan) ? { bg: "var(--warning)", fg: "var(--ink)", label: "$" }
  : { bg: "var(--surface-cream-strong)", fg: "var(--muted)", label: "RD" };

function Timeline({ data, onAsk }) {
  // Merge critical dates + every school deadline into one sorted stream.
  const events = [];
  data.criticalDates.forEach((m) => events.push({ date: m.date, title: m.label, detail: m.detail, kind: "milestone" }));
  data.colleges.forEach((c) =>
    (c.deadlines || []).forEach((d) => events.push({ date: d.date, title: `${c.short} — ${d.plan}`, detail: c.major, plan: d.plan, kind: "deadline" }))
  );
  events.sort((a, b) => orderKey(a.date) - orderKey(b.date));

  // Group by month label.
  const byMonth = [];
  events.forEach((e) => {
    const mon = (e.date.match(/^[A-Za-z]{3}/) || ["—"])[0];
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
        <Button variant="secondary" size="sm" onClick={onAsk}>Ask about a date ✱</Button>
      </header>

      {byMonth.length === 0 ? (
        <div className="cf-empty">
          No dates yet. Add schools or ask the copilot to set your key deadlines — they’ll appear here in order.
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
                          <span className="cf-nums" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>{e.date}</span>
                          <span className="cf-display" style={{ fontSize: 17, color: "var(--ink)" }}>{e.title}</span>
                        </div>
                        {e.detail ? <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{e.detail}</div> : null}
                      </div>
                      {tone ? (
                        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.5px", padding: "3px 9px", borderRadius: "var(--radius-pill)", background: tone.bg, color: tone.fg }}>{tone.label}</span>
                      ) : (
                        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted-soft)" }}>Milestone</span>
                      )}
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
window.Timeline = Timeline;
