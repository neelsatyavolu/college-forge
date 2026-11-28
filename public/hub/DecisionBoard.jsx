// The Decision board: the schools that admitted the student side by side, with the AI's two picks on request.
// Waitlisted and deferred schools show marked; a decision still covered on the Decisions tab never shows here.

const BOARD_STANDING = { committed: "Committed", admitted: "Admitted", waitlisted: "Waitlisted", deferred: "Deferred" };

async function loadBoard() {
  const res = await fetch("/api/decisions/board", { credentials: "same-origin", cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Couldn’t load the decision board.");
  return j;
}

function AidOfferEditor({ school, onSaved, onCancel }) {
  const { Button } = window.CollegeForgeDesignSystem_e95e63;
  const o = school.aidOffer || {};
  const amount = (v) => (v == null ? "" : String(v));
  const [draft, setDraft] = React.useState({ costOfAttendance: amount(o.costOfAttendance), grants: amount(o.grants), loans: amount(o.loans), workStudy: amount(o.workStudy), notes: o.notes || "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  // The server checks the amounts ("$12,000" is fine) and drops blank ones.
  const save = async (clear) => {
    const aidOffer = clear ? null : Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ""));
    setBusy(true);
    setError("");
    try {
      const j = await window.cfApi.applications({ action: "update", id: school.id, edit: { aidOffer } });
      onSaved(j.data);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const field = (key, label, hint, numeric) => (
    <label className="cf-board-field">
      <span>{label}</span>
      <input inputMode={numeric ? "numeric" : undefined} maxLength={numeric ? 20 : 2000} value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
  return (
    <div className="cf-board-aid" role="group" aria-label={`Aid offer for ${school.name}`}>
      {field("costOfAttendance", "Cost of attendance per year", "Tuition, housing, food and fees", true)}
      {field("grants", "Grants and scholarships per year", "Money you don’t pay back", true)}
      {field("loans", "Loans per year", "Federal and school loans", true)}
      {field("workStudy", "Work-study per year", "", true)}
      {field("notes", "Notes", "Conditions, renewal rules")}
      {error ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>{error}</p> : null}
      <div className="cf-row-actions">
        <Button size="sm" disabled={busy} onClick={() => save(false)}>Save offer</Button>
        {school.aidOffer ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => save(true)}>Remove</Button> : null}
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function BoardNotes({ items, tone }) {
  if (!items.length) return null;
  return <ul className={"cf-board-notes is-" + tone}>{items.map((t) => <li key={t}>{t}</li>)}</ul>;
}

function BoardSchoolRow({ school, editing, onEdit, onSaved, hideAidOffer }) {
  const { SchoolMark } = window.cfApp;
  return (
    <li className={"cf-board-row" + (school.pickable ? "" : " is-pending")}>
      <SchoolMark name={school.name} logo={school.logo} />
      <div className="cf-board-row__body">
        <div className="cf-board-row__head">
          <h3>{school.name}</h3>
          <span className="cf-board-tag">{BOARD_STANDING[school.standing]}</span>
          <span className="cf-board-rank" title="Weighted average rank (the List tab)">{school.average == null ? "Not ranked" : `#${school.average.toFixed(1)} avg`}</span>
        </div>
        <p className="cf-help">{school.rankSummary}</p>
        <p className="cf-board-cost">{school.cost ? school.cost.label : school.costNote}</p>
        {school.awards.length ? <p className="cf-help">Awards: {school.awards.map((a) => a.name + (a.amount ? ` (${a.amount})` : "")).join(", ")}</p> : null}
        {school.careerCovered ? null : <p className="cf-help">Not in the career data, so no pay or switching facts. That says nothing about the school.</p>}
        <BoardNotes items={school.pros} tone="pro" />
        <BoardNotes items={school.cons} tone="con" />
        {school.switch.length ? <p className="cf-help">Switching: {school.switch.map((s) => `${s.major} ${s.label}`).join(" · ")}</p> : null}
        {school.notes ? <p className="cf-board-said">Your notes: {school.notes}</p> : null}
        {school.decisionNote ? <p className="cf-board-said">{school.decisionNote}</p> : null}
        {editing ? <AidOfferEditor school={school} onSaved={onSaved} onCancel={() => onEdit(null)} /> : school.pickable && !(hideAidOffer && !school.aidOffer) ? (
          <button type="button" className="cf-link-btn" onClick={() => onEdit(school.id)}>{school.aidOffer ? "Edit aid offer" : "Add aid offer"}</button>
        ) : null}
      </div>
    </li>
  );
}

function PickCompare({ picks, schools }) {
  const [a, b] = picks.picks.map((p) => schools.find((s) => s.id === p.appId));
  if (!a || !b) return null;
  const cost = (s) => (s.cost ? s.cost.label : "Not known yet");
  const fixed = [
    { label: "Average rank", a: a.average == null ? "Not ranked" : a.average.toFixed(1), b: b.average == null ? "Not ranked" : b.average.toFixed(1) },
    { label: "Yearly cost", a: cost(a), b: cost(b) },
    { label: "Switching", a: a.switch.map((s) => `${s.major}: ${s.label}`).join("; ") || "—", b: b.switch.map((s) => `${s.major}: ${s.label}`).join("; ") || "—" },
  ];
  const rows = [...picks.rows, ...fixed];
  return (
    <div className="cf-board-compare" role="table" aria-label="Your two picks side by side">
      <div role="row" className="cf-board-compare__row is-head"><span role="columnheader">Compared</span><span role="columnheader">{a.name}</span><span role="columnheader">{b.name}</span></div>
      {rows.map((r, i) => (
        <div role="row" key={r.label + i} className="cf-board-compare__row">
          <span role="rowheader">{r.label}</span>
          <span role="cell" data-school={a.name}>{r.a || "—"}</span>
          <span role="cell" data-school={b.name}>{r.b || "—"}</span>
        </div>
      ))}
    </div>
  );
}

/** needAid false (not applying for need-based aid): no "Add aid offer" link; an offer already saved stays editable. */
function DecisionBoard({ tracker, onTrackerChange, needAid }) {
  const { Button } = window.CollegeForgeDesignSystem_e95e63;
  const [board, setBoard] = React.useState(null);
  const [error, setError] = React.useState("");
  const [editing, setEditing] = React.useState(null);
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState("");
  const revision = tracker.revision;

  React.useEffect(() => {
    let live = true;
    loadBoard().then((b) => { if (live) { setBoard(b); setError(""); } }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [revision]);

  const getPicks = async () => {
    setRunning(true);
    setError("");
    setProgress("Gathering your offers…");
    const before = board && board.picks ? board.picks.madeAt : "";
    try {
      const res = await fetch("/api/ai/decision-plan", { credentials: "same-origin", cache: "no-store" });
      const plan = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(plan.error || "Couldn’t start the comparison.");
      await window.cfStreamBuildChat(plan.step.prompt, (m) => setProgress(m), { mode: "decision" });
      const next = await loadBoard();
      setBoard(next);
      if (!next.picks || next.picks.madeAt === before) throw new Error("The AI didn’t save picks. Picks need ChatGPT or Grok connected in Settings.");
    } catch (e) { setError(e.message); } finally { setRunning(false); setProgress(""); }
  };

  const schools = board ? board.schools : [];
  const pickable = schools.filter((s) => s.pickable);
  const picks = board && board.picks;
  const byId = (id) => schools.find((s) => s.id === id);

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Decision board</h1>
          <p className="cf-page-lede">Your offers side by side: what the rankings say, what a year would cost, and your own notes.{board && board.targets.length ? ` Judged for ${board.targets.join(", ")}.` : ""} Only you see this page.</p>
        </div>
        {pickable.length ? <div className="cf-row-actions"><Button size="sm" disabled={running} onClick={getPicks}>{running ? "Comparing…" : picks ? "Refresh picks" : pickable.length > 1 ? "Get my two picks" : "Get my pick"}</Button></div> : null}
      </header>
      {error ? <div role="alert" className="cf-notice">{error}</div> : null}
      {running && progress ? <p className="cf-help" role="status" style={{ marginBottom: 16 }}>{progress}</p> : null}
      {!board && !error ? <p className="cf-help" role="status">Loading your offers…</p> : null}
      {board && !schools.length ? <div className="cf-empty">No offers yet. When you record an admission on <a href="#decisions">Decisions</a>, the school shows up here.</div> : null}

      {picks ? (
        <section className="cf-apps-group" aria-labelledby="board-picks">
          <div className="cf-apps-group__head"><h2 id="board-picks">{picks.picks.length > 1 ? "Your two best picks" : "Your best pick"}</h2><span>{new Date(picks.madeAt).toLocaleDateString()}</span></div>
          {board.stale ? <p className="cf-notice" role="note">Something changed since these picks were made (an offer, a note or your plans). Refresh them to include it.</p> : null}
          <ol className="cf-board-picks">
            {picks.picks.map((p, i) => (
              <li key={p.appId}>
                <span className="cf-board-picks__n">{i + 1}</span>
                <div>
                  <h3>{(byId(p.appId) || {}).name || "A school no longer on the board"}</h3>
                  <p className="cf-board-picks__headline">{p.headline}</p>
                  <p>{p.why}</p>
                  {p.watchOut ? <p className="cf-help">Watch out: {p.watchOut}</p> : null}
                </div>
              </li>
            ))}
          </ol>
          {picks.summary ? <p className="cf-board-summary">{picks.summary}</p> : null}
          {picks.picks.length > 1 ? <PickCompare picks={picks} schools={schools} /> : null}
        </section>
      ) : pickable.length ? (
        <p className="cf-help" style={{ marginBottom: 24 }}>Ask for picks and your connected AI weighs these schools against your majors, budget and notes. It uses only what’s saved here.</p>
      ) : null}

      {schools.length ? (
        <section className="cf-apps-group" aria-labelledby="board-all">
          <div className="cf-apps-group__head"><h2 id="board-all">Every offer</h2><span>{schools.length}</span></div>
          <ul className="cf-apps-list cf-board-list">
            {schools.map((s) => <BoardSchoolRow key={s.id} school={s} hideAidOffer={needAid === false} editing={editing === s.id} onEdit={setEditing} onSaved={(t) => { setEditing(null); onTrackerChange(t); }} />)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

window.DecisionBoard = DecisionBoard;
