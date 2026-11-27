// Essay schools: the schools the student writes supplements for. Every school is one until the student
// unchecks it (Workspace.essaySchools stores only the opted-out ones as false). An unchecked school stays on
// the list and keeps its drafts; its supplements leave Essays and every count.
const { Button } = window.CollegeForgeDesignSystem_e95e63;
const PLAN = window.cfEssayArchetypes;

const writingFor = (data, key) => !PLAN.isSchoolSkipped(key, { essaySchools: data.essaySchools });

async function saveEssaySchools(patch, onWorkspaceChange) {
  const ws = await window.cfApi.patch({ essaySchools: patch });
  if (onWorkspaceChange) onWorkspaceChange(ws);
  return ws;
}

/** One school's checkbox. `school` is a list college (or anything with slug and name). */
function EssaySchoolToggle({ data, school, onWorkspaceChange, label, className }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const key = school ? PLAN.essayGroupKey(school) : null;
  if (!key) return null;
  const writing = writingFor(data, key);
  const name = key === "uc-application" ? "the UC Application" : school.short || school.name || key;
  const toggle = async (next) => {
    setBusy(true);
    setError("");
    try {
      await saveEssaySchools({ [key]: next ? null : false }, onWorkspaceChange);
    } catch (e) {
      setError(e.message || "Couldn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className={"cf-essay-toggle" + (className ? " " + className : "")}
      title={writing ? `Writing supplements for ${name}. Uncheck to take them off Essays; drafts are kept.` : `Not writing supplements for ${name}. Check to put them back on Essays.`}>
      <input type="checkbox" checked={writing} disabled={busy} onChange={(e) => toggle(e.target.checked)}
        aria-label={label ? undefined : `Write supplements for ${name}`} />
      <span>{label || "Essays"}</span>
      {error ? <span role="alert" className="cf-essay-toggle__error">{error}</span> : null}
    </label>
  );
}

/** "Pick essay schools": every school with a checkbox, select all or none, saved in one patch. */
function EssaySchoolsSheet({ data, onWorkspaceChange, onClose }) {
  const rows = React.useMemo(() => PLAN.essaySchools(data.colleges, { essaySchools: data.essaySchools }), [data.colleges, data.essaySchools]);
  // Only the student's edits; untouched rows follow the saved workspace, so a change made elsewhere isn't undone.
  const [picked, setPicked] = React.useState({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const ref = React.useRef(null);
  React.useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open && dialog.showModal) dialog.showModal();
  }, []);
  const setAll = (on) => setPicked(Object.fromEntries(rows.map((r) => [r.key, on])));
  const isOn = (r) => (r.key in picked ? picked[r.key] : r.writing);
  const count = rows.filter(isOn).length;
  const changes = Object.fromEntries(rows.filter((r) => isOn(r) !== r.writing).map((r) => [r.key, isOn(r) ? null : false]));
  const save = async (event) => {
    event.preventDefault();
    if (!Object.keys(changes).length) return onClose();
    setBusy(true);
    setError("");
    try {
      await saveEssaySchools(changes, onWorkspaceChange);
      onClose();
    } catch (e) {
      setError(e.message || "Couldn’t save. Try again.");
      setBusy(false);
    }
  };
  return (
    <dialog ref={ref} className="cf-essay-sheet" aria-labelledby="essay-sheet-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={save}>
        <header className="cf-essay-sheet__head">
          <h2 id="essay-sheet-title" className="cf-display">Pick essay schools</h2>
          <p className="cf-help">Essays shows supplements for the schools you check. Unchecked schools stay on your list and keep their drafts. The Common App essay is always on.</p>
        </header>
        {rows.length ? (
          <React.Fragment>
            <div className="cf-essay-sheet__bar">
              <span className="cf-nums">{count} of {rows.length}</span>
              <span>
                <button type="button" className="cf-link-btn" disabled={busy || count === rows.length} onClick={() => setAll(true)}>Select all</button>
                <button type="button" className="cf-link-btn" disabled={busy || count === 0} onClick={() => setAll(false)}>Select none</button>
              </span>
            </div>
            <ul className="cf-essay-sheet__list">
              {rows.map((r) => (
                <li key={r.key}>
                  <label>
                    <input type="checkbox" checked={isOn(r)} disabled={busy} onChange={(e) => setPicked({ ...picked, [r.key]: e.target.checked })} />
                    <span className="cf-essay-sheet__name">{r.title}{r.subtitle ? <small>{r.subtitle}</small> : null}</span>
                  </label>
                </li>
              ))}
            </ul>
          </React.Fragment>
        ) : <p className="cf-help">No schools on your list yet. Add schools on the List or Progress tab and they show here.</p>}
        {error ? <p role="alert" className="cf-essay-toggle__error">{error}</p> : null}
        <footer className="cf-essay-sheet__foot">
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </footer>
      </form>
    </dialog>
  );
}

/** The schools the student isn't writing for, each with a one-click "Add back". Nothing when there are none. */
function NotWritingFor({ data, onWorkspaceChange }) {
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const skipped = PLAN.essaySchools(data.colleges, { essaySchools: data.essaySchools }).filter((r) => !r.writing);
  if (!skipped.length) return null;
  const addBack = async (key) => {
    setBusy(key);
    setError("");
    try {
      await saveEssaySchools({ [key]: null }, onWorkspaceChange);
    } catch (e) {
      setError(e.message || "Couldn’t save. Try again.");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="cf-essay-skipped">
      <span className="cf-essay-skipped__label">Not writing for:</span>
      {skipped.map((r) => (
        <span key={r.key} className="cf-essay-skipped__school">
          {r.title}
          <button type="button" className="cf-link-btn" disabled={!!busy} onClick={() => addBack(r.key)} aria-label={`Add ${r.title} back to Essays`}>{busy === r.key ? "Adding…" : "Add back"}</button>
        </span>
      ))}
      {error ? <span role="alert" className="cf-essay-toggle__error">{error}</span> : null}
    </div>
  );
}

window.EssaySchoolToggle = EssaySchoolToggle;
window.EssaySchoolsSheet = EssaySchoolsSheet;
window.NotWritingFor = NotWritingFor;
