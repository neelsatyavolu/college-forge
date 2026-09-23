const { VerdictBadge, Badge, Button } = window.CollegeForgeDesignSystem_e95e63;

function tasksFor(c, apps) {
  const tasks = [];
  const status = (apps && apps[c.slug] && apps[c.slug].status) || "researching";
  if (status === "withdrawn") return tasks;
  const submitted = ["submitted", "accepted", "rejected", "waitlisted", "deferred"].includes(status);
  const school = c.short || c.name;
  if (c.supp === "Supps required") {
    tasks.push({ id: "supplement-required", label: `${school} — required supplements`, done: false });
  } else if (c.supp === "Supps optional") {
    tasks.push({ id: "supplement-optional", label: `${school} — optional supplement`, done: false, optional: true });
  }
  tasks.push({ id: "application-review", label: `${school} — application & activities review`, done: submitted });
  tasks.push({ id: "submission-check", label: `${school} — application submission check`, done: submitted });
  return tasks;
}

function Planner({ data, onAsk, onWorkspaceChange }) {
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const apps = data.applications || {};
  const doneMap = data.plannerDone || {};
  const priorityFirst = [...(data.colleges || [])].sort(
    (a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || (a.rank || 0) - (b.rank || 0)
  );

  const allTasks = priorityFirst.flatMap((c) =>
    tasksFor(c, apps).map((t) => ({ ...t, key: c.slug + ":" + t.id, school: c }))
  );
  const isDone = (t) => (doneMap[t.key] !== undefined ? doneMap[t.key] : t.done);
  const completed = allTasks.filter(isDone).length;
  const pct = allTasks.length ? Math.round((completed / allTasks.length) * 100) : 0;

  const grouped = priorityFirst
    .map((c) => ({ c, tasks: tasksFor(c, apps).map((t) => ({ ...t, key: c.slug + ":" + t.id })) }))
    .filter((g) => g.tasks.length);

  const withdrawn = priorityFirst.filter((college) => apps[college.slug]?.status === "withdrawn");
  // Numeric keys depended on which rows existed at the time. Their old meaning
  // cannot be recovered from the current college, so never transfer those checks.
  const needsLegacyReview = (college) => !doneMap[college.slug + ":legacy-reviewed"] &&
    Object.keys(doneMap).some((key) => key.startsWith(college.slug + ":") && /^\d+$/.test(key.slice(college.slug.length + 1)));

  const toggle = async (key, checked) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const ws = await window.cfApi.patch({ plannerToggle: { key, done: !checked } });
      if (onWorkspaceChange) onWorkspaceChange(ws);
    } catch (e) {
      setError(e.message || "Could not save this task. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Planner</h1>
          <p className="cf-page-lede">Supplement and application checklist by school. Checks save to your hub. Update application statuses in Your shortlist; checking a task here doesn’t change a school’s status.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onAsk}>Ask copilot to draft ✱</Button>
      </header>

      {error ? <p role="alert" style={{ color: "var(--error)" }}>{error}</p> : null}
      {withdrawn.length ? <p style={{ fontSize: 13, color: "var(--muted)" }}>Withdrawn applications are excluded from active tasks: {withdrawn.map((college) => college.short || college.name).join(", ")}.</p> : null}
      {grouped.length > 0 ? (
        <div style={{ marginBottom: 28, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1, height: 8, borderRadius: "var(--radius-pill)", background: "var(--surface-card)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: pct + "%", background: "var(--coral)", borderRadius: "var(--radius-pill)", transition: "width 220ms ease" }} />
          </div>
          <span className="cf-nums" style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--muted)", flexShrink: 0 }}>{completed}/{allTasks.length} done · {pct}%</span>
        </div>
      ) : null}

      {grouped.length === 0 ? (
        <div className="cf-empty">
          No active tasks yet. Add schools to your list and the planner will build a checklist ordered by priority.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {grouped.map(({ c, tasks }) => (
            <section key={c.slug} style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 20px", background: c.priority ? "color-mix(in srgb, var(--coral) 5%, transparent)" : "var(--surface-soft)", borderBottom: "1px solid var(--hairline)", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexWrap: "wrap" }}>
                  <h2 className="cf-display" style={{ margin: 0, fontSize: 20, color: "var(--ink)" }}>{c.short}</h2>
                  {c.priority ? <Badge variant="coral" uppercase>Priority</Badge> : null}
                  {c.verdict ? <VerdictBadge tone={c.verdict.tone}>{c.verdict.label}</VerdictBadge> : null}
                  {apps[c.slug] ? <Badge variant="cream" uppercase>{apps[c.slug].status}</Badge> : null}
                </div>
                {c.deadline ? (
                  <span style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)" }}>{c.deadline}</span>
                ) : null}
              </div>
              {needsLegacyReview(c) ? <div role="note" style={{ padding: "14px 20px", background: "var(--surface-soft)", fontSize: 13, color: "var(--body)", lineHeight: 1.5 }}>
                Please reconfirm this checklist. Older checks can’t be safely matched to these tasks and have not been carried over.
                <div style={{ marginTop: 8 }}><Button variant="secondary" size="sm" disabled={saving} onClick={() => toggle(c.slug + ":legacy-reviewed", false)}>I’ve reviewed this checklist</Button></div>
              </div> : null}
              <div>
                {tasks.map((t, i) => {
                  const checked = isDone(t);
                  return (
                    <label key={t.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", minHeight: 48, cursor: "pointer", borderTop: i === 0 ? "none" : "1px solid var(--hairline-soft)" }}>
                      <input type="checkbox" disabled={saving} checked={checked} onChange={() => toggle(t.key, checked)}
                        style={{ width: 18, height: 18, accentColor: "var(--coral)", cursor: "pointer", flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 14, color: checked ? "var(--muted-soft)" : "var(--ink)", textDecoration: checked ? "line-through" : "none" }}>{t.label}</span>
                      {t.optional ? <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted-soft)" }}>Optional</span> : null}
                    </label>
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
window.Planner = Planner;
