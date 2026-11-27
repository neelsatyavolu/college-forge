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

// ── Choose-one prompts and per-college prompts ─────────────────────────────────

/** The prompt text split the way lib/supplement-prompts.ts joins it: intro, "Option N:" lines, then notes. */
function promptParts(it) {
  const parts = String(it.prompt || "").split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const isOption = (p) => /^Option \d+:/.test(p);
  const firstOption = parts.findIndex(isOption);
  const isNote = (p) => /^\(.*\)$/.test(p);
  const intro = parts.filter((p, i) => !isOption(p) && !isNote(p) && (firstOption < 0 || i < firstOption));
  const notes = parts.filter((p, i) => !isOption(p) && (isNote(p) || (firstOption >= 0 && i > firstOption)));
  const options = it.options && it.options.length ? it.options : parts.filter(isOption).map((p) => p.replace(/^Option \d+:\s*/, ""));
  return { intro, options, notes };
}

/** The prompt under the essay title: the question, and for choose-one prompts the options to pick from. */
function EssayPrompt({ it, chosen, busy, onChoose }) {
  const { intro, options, notes } = promptParts(it);
  const [changing, setChanging] = React.useState(false);
  const picked = Number.isInteger(chosen) && chosen < options.length ? chosen : null;
  const showList = options.length > 1 && (picked === null || changing);
  return (
    <div className="cf-essay-prompt">
      <div className="cf-essay-prompt__text">
        {intro.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      {options.length > 1 && picked !== null && !changing ? (
        <div className="cf-essay-prompt__chosen">
          <span className="cf-essay-prompt__label">You’re answering option {picked + 1} of {options.length}</span>
          <p>{options[picked]}</p>
          <button type="button" className="cf-link-btn" disabled={busy} onClick={() => setChanging(true)}>Change</button>
        </div>
      ) : null}
      {showList ? (
        <div className="cf-essay-prompt__options" role="group" aria-label="Pick the option you’re answering">
          <span className="cf-essay-prompt__label">Pick the one you’re answering</span>
          {options.map((o, i) => (
            <button key={i} type="button" className={"cf-essay-option" + (picked === i ? " is-picked" : "")} aria-pressed={picked === i} disabled={busy}
              onClick={() => { onChoose(i); setChanging(false); }}>
              <span className="cf-essay-option__n cf-nums">{i + 1}</span>
              <span>{o}</span>
            </button>
          ))}
        </div>
      ) : null}
      {options.length === 1 ? <p className="cf-essay-prompt__single">{options[0]}</p> : null}
      {notes.map((n, i) => <p key={i} className="cf-essay-prompt__note">{n}</p>)}
    </div>
  );
}

/** "Applying to [college]" for schools whose prompts depend on the college or program (Cornell, Tufts). */
function AudienceControl({ items, hidden, busy, onSave }) {
  const plan = window.cfEssayArchetypes;
  const set = plan.audienceSet(items);
  if (!set) return null;
  const chosen = plan.chosenAudience(items, hidden);
  return (
    <label className={"cf-audience" + (chosen === null ? " is-open" : "")}>
      <span>{chosen === null ? "Which college or program are you applying to?" : "Applying to"}</span>
      <select value={chosen === null ? "__" : chosen} disabled={busy}
        onChange={(e) => e.target.value !== "__" && onSave(plan.audiencePatch(items, e.target.value))}>
        {chosen === null ? <option value="__">Choose…</option> : null}
        {set.audiences.map((a) => <option key={a} value={a}>{a}</option>)}
        {set.shared ? <option value="">None of these</option> : null}
      </select>
    </label>
  );
}

window.EssayPrompt = EssayPrompt;
window.AudienceControl = AudienceControl;

/** A modal sheet for the Essays page (overview, add or edit a prompt): Escape or Close closes it. */
function EssaySheet({ title, onClose, children, wide }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open && dialog.showModal) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} className={"cf-essay-sheet" + (wide ? " cf-essay-sheet--wide" : "")} aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="cf-essay-sheet__scroll">
        <header className="cf-essay-sheet__head cf-essay-sheet__head--row">
          <h2 className="cf-display">{title}</h2>
          <button type="button" className="cf-link-btn" onClick={onClose}>Close</button>
        </header>
        <div className="cf-essay-sheet__body">{children}</div>
      </div>
    </dialog>
  );
}

window.EssaySheet = EssaySheet;
