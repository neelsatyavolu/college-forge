const { Badge, Button } = window.CollegeForgeDesignSystem_e95e63;

const CSS_LABEL = { required: "CSS Profile required", not_required: "CSS Profile not required", unknown: "CSS Profile: check the school's aid page" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-01" -> "Nov 1" (with the year when it isn't this year's). */
function shortDate(iso, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso;
  const day = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return m[1] === String(today || "").slice(0, 4) ? day : `${day}, ${m[1]}`;
}

/** One row per school on the Applications tab: which aid forms it asks for, its aid dates, and its aid to-dos. */
function AidBySchool({ revision }) {
  const [plan, setPlan] = React.useState(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [note, setNote] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/aid", { credentials: "same-origin", cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.success === false) throw new Error((j && j.error) || "Couldn't load the aid checklist.");
      setPlan(j.data);
      setError("");
    } catch (e) { setError(e.message || "Couldn't load the aid checklist."); }
  }, []);
  React.useEffect(() => { load(); }, [load, revision]);

  const addTodos = async (row) => {
    setBusy(row.appId);
    setNote("");
    try {
      // Sequential: each call sees the one before, and the server skips a to-do that is already open.
      for (const t of row.todos) await window.cfApi.applications({ action: "followup-add", id: row.appId, text: t.text, due: t.due || undefined });
      setNote(`Added ${row.todos.length === 1 ? "a to-do" : `${row.todos.length} to-dos`} for ${row.name}. They're on its Progress card.`);
      await load();
    } catch (e) { setError(e.message || "Couldn't add the to-dos. Try again."); }
    finally { setBusy(""); }
  };

  if (error && !plan) return <p className="cf-notice" role="alert">{error}</p>;
  if (!plan) return <p role="status" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Loading the aid checklist…</p>;
  if (!plan.schools.length) return <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>Add schools to <a href="#shortlist">Your shortlist</a> to see which aid forms each one asks for.</p>;
  const { totals } = plan;
  const today = window.cfApp && window.cfApp.todayIso ? window.cfApp.todayIso() : new Date().toISOString().slice(0, 10);
  return (
    <div>
      {error ? <p className="cf-notice" role="alert">{error}</p> : null}
      {note ? <p role="status" style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>{note}</p> : null}
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
        CSS Profile: <span className="cf-nums">{totals.cssSchools}</span> {totals.cssSchools === 1 ? "school" : "schools"}{totals.idocSchools ? <React.Fragment> · IDOC: <span className="cf-nums">{totals.idocSchools}</span></React.Fragment> : null}. Read from each school's aid pages; follow the source link to confirm.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
        {plan.schools.map((row) => {
          const dates = row.deadlines.filter((d) => d.date >= today).slice(0, 3);
          return (
            <li key={row.appId} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "start", padding: "12px 0", borderTop: "1px solid var(--hairline)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <strong style={{ fontSize: 14, color: "var(--ink)" }}>{row.name}</strong>
                  {row.ignoreAid ? <Badge variant="cream">Not applying for aid</Badge> : (
                    <React.Fragment>
                      <Badge variant={row.css === "required" ? "coral" : "cream"}>{CSS_LABEL[row.css]}</Badge>
                      {row.idoc ? <Badge variant="teal">IDOC</Badge> : null}
                    </React.Fragment>
                  )}
                </div>
                {!row.ignoreAid && dates.length ? (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    {dates.map((d) => <span key={d.plan + d.date} style={{ marginRight: 12, display: "inline-block", whiteSpace: "nowrap" }}>{d.plan} <span className="cf-nums">{shortDate(d.date, today)}</span></span>)}
                  </div>
                ) : null}
                {row.followUps.length ? (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>To do: {row.followUps.map((f) => f.text).join("; ")}</div>
                ) : null}
                {/^https?:\/\//.test(row.cssSource || "") && !row.ignoreAid ? (
                  <a href={row.cssSource} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--coral)" }}>
                    Source{row.cssCheckedAt ? `, checked ${row.cssCheckedAt}` : ""} →
                  </a>
                ) : null}
              </div>
              {row.todos.length ? (
                <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => addTodos(row)}>
                  {busy === row.appId ? "Adding…" : `Add ${row.todos.length === 1 ? "to-do" : `${row.todos.length} to-dos`}`}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
window.AidBySchool = AidBySchool;
