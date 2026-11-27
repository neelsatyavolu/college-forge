// Choose-N sets (UC: answer 4 of the 8 PIQs). The student picks which ones in a sheet; the rest are hidden
// (essayHidden), so they leave the group and every count but keep their drafts under "Hidden".
const { Button: ChoiceButton } = window.CollegeForgeDesignSystem_e95e63;

/** The sheet: one checkbox per prompt in the set, at most `set.choose` checked. */
function PickSetSheet({ set, initial, busy, onSave, onClose }) {
  const [picked, setPicked] = React.useState(initial);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open && dialog.showModal) dialog.showModal();
  }, []);
  const full = picked.length >= set.choose;
  const toggle = (id, on) => setPicked(on ? [...picked, id] : picked.filter((x) => x !== id));
  const save = (event) => {
    event.preventDefault();
    if (picked.length === set.choose) onSave(picked);
  };
  return (
    <dialog ref={ref} className="cf-essay-sheet" aria-labelledby="pick-set-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={save}>
        <header className="cf-essay-sheet__head">
          <h2 id="pick-set-title" className="cf-display">Choose your {set.choose}</h2>
          <p className="cf-help">Pick the {set.choose} prompts you’re answering. The others move to Hidden and keep any drafts.</p>
        </header>
        <div className="cf-essay-sheet__bar" style={{ paddingBlock: 10 }}>
          <span className="cf-nums">{picked.length} of {set.choose} picked</span>
        </div>
        <ul className="cf-essay-sheet__list">
          {set.items.map((it) => {
            const on = picked.includes(it.id);
            return (
              <li key={it.id}>
                <label>
                  <input type="checkbox" checked={on} disabled={busy || (!on && full)} onChange={(e) => toggle(it.id, e.target.checked)} />
                  <span className="cf-essay-sheet__name">{it.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <footer className="cf-essay-sheet__foot">
          <ChoiceButton type="button" variant="secondary" size="sm" disabled={busy} onClick={onClose}>Cancel</ChoiceButton>
          <ChoiceButton type="submit" size="sm" disabled={busy || picked.length !== set.choose}>{busy ? "Saving…" : "Save"}</ChoiceButton>
        </footer>
      </form>
    </dialog>
  );
}

/** The sidebar row for a set: "Choose your 4" until exactly 4 are shown, then "Change". */
function PickSetControl({ set, hidden, busy, onSave }) {
  const [open, setOpen] = React.useState(false);
  const shown = set.items.filter((it) => !hidden[it.id]).map((it) => it.id);
  const chosen = shown.length === set.choose;
  const save = async (ids) => {
    await onSave(window.cfEssayArchetypes.pickPatch(set.items, ids));
    setOpen(false);
  };
  return (
    <div className="cf-pick-set">
      <span>{chosen ? `Answering ${set.choose} of ${set.items.length}` : `Answer ${set.choose} of ${set.items.length}`}</span>
      <button type="button" className="cf-link-btn" disabled={busy} onClick={() => setOpen(true)}>{chosen ? "Change" : `Choose your ${set.choose}`}</button>
      {open ? <PickSetSheet set={set} initial={chosen ? shown : []} busy={busy} onSave={save} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

window.PickSetControl = PickSetControl;
