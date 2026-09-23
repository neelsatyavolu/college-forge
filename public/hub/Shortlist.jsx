const { Badge, VerdictBadge, SectionLabel, Button } = window.CollegeForgeDesignSystem_e95e63;

const TIER_META = {
  reach: { label: "Reaches", dot: "var(--error)" },
  target: { label: "Targets", dot: "var(--accent-amber)" },
  safety: { label: "Likely", dot: "var(--accent-teal)" },
};

const APP_STATUSES = [
  "researching", "preparing", "submitted", "accepted", "rejected", "waitlisted", "deferred", "withdrawn",
];

const SUPP_STYLE = {
  "No supps": { bg: "color-mix(in srgb, var(--success) 14%, transparent)", color: "var(--success)" },
  "Supps optional": { bg: "color-mix(in srgb, var(--warning) 16%, transparent)", color: "var(--warning)" },
  "Supps required": { bg: "var(--surface-card)", color: "var(--muted)" },
};

function SuppPill({ load }) {
  const s = SUPP_STYLE[load] || SUPP_STYLE["Supps required"];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "var(--radius-xs)", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.4px", background: s.bg, color: s.color }}>{load || "—"}</span>
  );
}

function SchoolRow({ s, last, status, onTier, onStatus, onRemove, busy, error }) {
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  return (
    <div style={{ display: "block", background: s.priority ? "color-mix(in srgb, var(--coral) 5%, transparent)" : "transparent", borderBottom: last ? "none" : "1px solid var(--hairline)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16, alignItems: "center", padding: "16px 20px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <h3 className="cf-display" style={{ margin: 0, fontSize: 19, lineHeight: 1.3, color: "var(--ink)" }}>{s.name || s.short}</h3>
            {s.priority ? <Badge variant="coral" uppercase>Priority</Badge> : null}
            {isUcCampus(s) ? <Badge variant="teal" uppercase>UC Application</Badge> : null}
          </div>
          <div style={{ fontSize: 13, color: "var(--body)", marginBottom: 6 }}>
            {s.major || "—"}
            {s.location ? <span style={{ color: "var(--muted-soft)" }}> · {s.location}</span> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <SuppPill load={s.supp} />
            {s.deadline ? (
              <span style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)" }}>{s.deadline}</span>
            ) : null}
            {s.admit ? <span className="cf-nums" style={{ fontSize: 12, color: "var(--muted)" }}>Overall admission rate: {s.admit}</span> : null}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
              Tier
              <select disabled={busy} value={TIER_META[s.tier] ? s.tier : ""} onChange={(e) => onTier(s.slug, e.target.value)}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: "var(--radius-xs)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)" }}>
                <option value="" disabled>Not assessed</option>
                <option value="reach">Reach</option>
                <option value="target">Target</option>
                <option value="safety">Likely</option>
              </select>
            </label>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
              Status
              <select disabled={busy} value={status || "researching"} onChange={(e) => onStatus(s.slug, e.target.value)}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: "var(--radius-xs)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)" }}>
                {APP_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </label>
            {!confirmRemove ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove school</Button> : null}
          </div>
          {confirmRemove ? <div style={{ marginTop: 12, padding: 12, background: "var(--surface-soft)", borderRadius: "var(--radius-sm)" }}>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--body)" }}>Remove {s.name || s.short} from your list? Saved essay drafts will remain.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button size="sm" disabled={busy} onClick={() => onRemove(s.slug)}>Confirm removal</Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep school</Button>
            </div>
          </div> : null}
          {error ? <p role="alert" style={{ margin: "10px 0 0", color: "var(--error)", fontSize: 13 }}>{error}</p> : null}
        </div>
        {s.verdict ? <div><VerdictBadge tone={s.verdict.tone}>{s.verdict.label}</VerdictBadge></div> : null}
      </div>
    </div>
  );
}

function isUcCampus(c) {
  const slug = String((c && c.slug) || "").toLowerCase();
  const name = String((c && (c.name || c.short)) || "").toLowerCase();
  if (slug.indexOf("university-of-california-") === 0) return true;
  if (slug === "ucla") return true;
  if (name.indexOf("university of california") !== -1) return true;
  return false;
}

/** Soft app count: all UC campuses share one UC Application slot. */
function applicationSlotCount(colleges) {
  let nonUc = 0;
  let hasUc = false;
  for (const c of colleges || []) {
    if (isUcCampus(c)) hasUc = true;
    else nonUc++;
  }
  return nonUc + (hasUc ? 1 : 0);
}

function Shortlist({ data, onAsk, onWorkspaceChange }) {
  const [filter, setFilter] = React.useState("all");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState("");
  const apps = data.applications || {};
  const byTier = {
    reach: data.colleges.filter((c) => c.tier === "reach"),
    target: data.colleges.filter((c) => c.tier === "target"),
    safety: data.colleges.filter((c) => c.tier === "safety"),
  };
  const untiered = data.colleges.filter((c) => !c.tier || !TIER_META[c.tier]);
  const totalSupps = data.colleges.filter((c) => c.supp && c.supp !== "No supps").length;
  const ucCount = data.colleges.filter(isUcCampus).length;
  const appSlots = applicationSlotCount(data.colleges);
  const FILTERS = [
    { id: "all", label: "All" }, { id: "reach", label: "Reaches" },
    { id: "target", label: "Targets" }, { id: "safety", label: "Likely" },
  ];

  const saveChange = async (slug, action, message) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const ws = await action();
      if (onWorkspaceChange) onWorkspaceChange(ws);
      setNotice(message);
    } catch (e) {
      setError({ slug, message: e.message || "Could not save this change. Please try again." });
    } finally { setBusy(false); }
  };
  const onTier = (slug, tier) => saveChange(slug, () => window.cfApi.patch({ collegePatch: { slug, tier } }), "School tier updated.");
  const onStatus = (slug, status) => saveChange(slug, () => window.cfApi.patch({ application: { slug, status } }), "Application status updated.");
  const onRemove = (slug) => saveChange(slug, async () => {
    const response = await fetch(`/api/workspace/colleges?slug=${encodeURIComponent(slug)}`, { method: "DELETE", credentials: "same-origin" });
    const result = await response.json();
    if (!response.ok || !result.success || !result.data) throw new Error(result.error || "Could not remove this school. Please try again.");
    return result.data;
  }, "School removed from your list.");

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">School list</h1>
          <p className="cf-page-lede">
            Track your schools and application progress. Reach, target, and likely are planning categories, not admission or financial-aid guarantees. Overall admission rates are not your personal odds.
            {ucCount > 0
              ? " UC campuses share one UC Application — they count as a single app slot even if you list several campuses."
              : ""}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onAsk}>Ask copilot to adjust ✱</Button>
      </header>

      <div role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", marginBottom: notice || busy ? 16 : 0 }}>{busy ? "Saving change…" : notice}</div>

      {data.colleges.length > 0 ? (
        <div className="cf-grid-short-stats" style={{ marginBottom: 28 }}>
          {[
            ["Campuses", data.colleges.length],
            ["App slots", appSlots],
            ["Reaches", byTier.reach.length],
            ["With supps", `${totalSupps}/${data.colleges.length}`],
          ].map(([l, v]) => (
            <div key={l}>
              <div className="cf-display cf-nums" style={{ fontSize: 32, lineHeight: 1, letterSpacing: "-0.5px", color: "var(--ink)" }}>{v}</div>
              <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)", marginTop: 4 }}>{l}</div>
            </div>
          ))}
        </div>
      ) : null}

      {data.colleges.length === 0 ? (
        <div className="cf-empty">No schools on your list yet. Tell the copilot which colleges to add, or search from Explore.</div>
      ) : (
        <React.Fragment>
          <div style={{ display: "flex", gap: 4, marginBottom: 24, flexWrap: "wrap" }} role="group" aria-label="Filter by tier">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                  className={"cf-filter-pill cf-press" + (active ? " is-active" : "")}
                  aria-pressed={active}>{f.label}</button>
              );
            })}
          </div>

          {["reach", "target", "safety"].map((tier) => {
            if (filter !== "all" && filter !== tier) return null;
            const list = byTier[tier];
            if (list.length === 0) return null;
            const meta = TIER_META[tier];
            return (
              <section key={tier} style={{ marginBottom: 40 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.dot }} />
                  <h2 className="cf-display" style={{ margin: 0, fontSize: "clamp(22px, 3vw, 28px)", letterSpacing: "-0.3px", color: "var(--ink)" }}>{meta.label}</h2>
                  <span className="cf-nums" style={{ fontSize: 13, color: "var(--muted)" }}>({list.length})</span>
                </div>
                <div style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
                  {list.map((s, i) => (
                    <SchoolRow key={s.slug} s={s} last={i === list.length - 1}
                      status={apps[s.slug] && apps[s.slug].status}
                      onTier={onTier} onStatus={onStatus} onRemove={onRemove} busy={busy} error={error?.slug === s.slug ? error.message : ""} />
                  ))}
                </div>
              </section>
            );
          })}

          {filter !== "all" && byTier[filter].length === 0 ? <div className="cf-empty">No schools in this category yet. Choose All to see your full list.</div> : null}

          {filter === "all" && untiered.length > 0 ? (
            <section style={{ marginBottom: 40 }}>
              <h2 className="cf-display" style={{ margin: "0 0 16px", fontSize: 22, color: "var(--ink)" }}>Not assessed yet</h2>
              <div style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
                {untiered.map((s, i) => (
                  <SchoolRow key={s.slug} s={s} last={i === untiered.length - 1}
                    status={apps[s.slug] && apps[s.slug].status}
                    onTier={onTier} onStatus={onStatus} onRemove={onRemove} busy={busy} error={error?.slug === s.slug ? error.message : ""} />
                ))}
              </div>
            </section>
          ) : null}
        </React.Fragment>
      )}
    </div>
  );
}
window.Shortlist = Shortlist;
