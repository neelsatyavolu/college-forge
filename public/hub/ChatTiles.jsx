// Tiles the onboarding interview draws from the AI's tool calls: choice questions, the transcript
// upload, numbers, school search, the draft list and the ED/EA strategy. Names are prefixed (oc)
// because hub scripts share one global scope.
const { Button: OcButton } = window.CollegeForgeDesignSystem_e95e63;

function OcChoiceTiles({ q, disabled, onAnswer }) {
  const multi = q.kind === "multi";
  const [picked, setPicked] = React.useState([]);
  const [other, setOther] = React.useState("");
  const toggle = (opt) => {
    if (!multi) return onAnswer(opt.label);
    setPicked((p) => (p.includes(opt.label) ? p.filter((x) => x !== opt.label) : [...p, opt.label]));
  };
  const submitMulti = () => {
    const all = [...picked, ...(other.trim() ? [other.trim()] : [])];
    if (all.length) onAnswer(all.join(", "));
  };
  return (
    <div className="oc-tiles" role={multi ? "group" : "radiogroup"} aria-label={q.prompt}>
      <div className="oc-tile-grid">
        {(q.options || []).map((opt) => (
          <button key={opt.value} type="button" className="oc-tile" aria-pressed={picked.includes(opt.label)} disabled={disabled} onClick={() => toggle(opt)}>
            <span className="oc-tile-label">{opt.label}</span>
            {opt.hint && <span className="oc-tile-hint">{opt.hint}</span>}
          </button>
        ))}
      </div>
      {(multi || q.allowOther) && (
        <div className="oc-tile-row">
          {q.allowOther && <input className="oc-input" placeholder="Something else" value={other} disabled={disabled} onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !multi && other.trim()) onAnswer(other.trim()); }} />}
          {multi && <OcButton size="sm" disabled={disabled || (!picked.length && !other.trim())} onClick={submitMulti}>Continue</OcButton>}
          {!multi && q.allowOther && <OcButton size="sm" variant="secondary" disabled={disabled || !other.trim()} onClick={() => onAnswer(other.trim())}>Send</OcButton>}
        </div>
      )}
    </div>
  );
}

function OcConfirmTiles({ disabled, onAnswer }) {
  return (
    <div className="oc-tile-grid oc-tile-grid--two">
      <button type="button" className="oc-tile" disabled={disabled} onClick={() => onAnswer("Yes")}><span className="oc-tile-label">Yes</span></button>
      <button type="button" className="oc-tile" disabled={disabled} onClick={() => onAnswer("No")}><span className="oc-tile-label">No</span></button>
    </div>
  );
}

function OcNumberTile({ q, disabled, onAnswer }) {
  const [value, setValue] = React.useState("");
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(n) && (q.min == null || n >= q.min) && (q.max == null || n <= q.max);
  return (
    <form className="oc-tile-row" onSubmit={(e) => { e.preventDefault(); if (valid) onAnswer(value.trim()); }}>
      <input className="oc-input oc-input--number" inputMode="decimal" value={value} disabled={disabled} aria-label={q.prompt}
        placeholder={q.min != null && q.max != null ? `${q.min} – ${q.max}` : "Number"} onChange={(e) => setValue(e.target.value)} />
      <OcButton size="sm" type="submit" disabled={disabled || !valid}>Send</OcButton>
      <button type="button" className="oc-link" disabled={disabled} onClick={() => onAnswer("I don't know it yet")}>I don't know</button>
    </form>
  );
}

function OcUploadTile({ disabled, onAnswer }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [over, setOver] = React.useState(false);
  const inputRef = React.useRef(null);
  const upload = async (files) => {
    if (!files || !files.length) return;
    setBusy(true); setError("");
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/upload", { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Upload failed.");
      const names = (j.saved || []).map((s) => s.name);
      if (!names.length) throw new Error((j.errors || []).join(" · ") || "That file couldn't be read.");
      onAnswer(`I uploaded ${names.join(", ")}.`);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  return (
    <div>
      <label className={"oc-upload" + (over ? " is-over" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && !busy) upload(e.dataTransfer.files); }}>
        <input ref={inputRef} type="file" accept=".pdf,.docx,.txt,.csv" multiple hidden disabled={disabled || busy} onChange={(e) => upload(e.target.files)} />
        <span className="oc-upload-icon" aria-hidden="true">↑</span>
        <span className="oc-upload-title">{busy ? "Reading your file…" : "Drop your transcript here, or choose a file"}</span>
        <span className="oc-upload-hint">PDF, Word or text · up to 15 MB</span>
      </label>
      {error && <p className="oc-error" role="alert">{error}</p>}
      <button type="button" className="oc-link" disabled={disabled || busy} onClick={() => onAnswer("I don't have my transcript handy. Let's do it by hand.")}>I'll type my grades instead</button>
    </div>
  );
}

function OcSchoolSearchTile({ disabled, onAnswer }) {
  const [catalog, setCatalog] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [picked, setPicked] = React.useState([]);
  React.useEffect(() => { window.cfApi.catalog().then((c) => setCatalog(c || [])).catch(() => {}); }, []);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const matches = q.trim().length < 2 ? [] : catalog.filter((c) => norm(c.name).includes(norm(q)) && !picked.includes(c.name)).slice(0, 6);
  const add = (name) => { setPicked((p) => [...p, name]); setQ(""); };
  return (
    <div className="oc-tiles">
      {picked.length > 0 && <div className="oc-chips">{picked.map((n) => <button key={n} type="button" className="oc-chip" onClick={() => setPicked((p) => p.filter((x) => x !== n))} aria-label={`Remove ${n}`}>{n} ×</button>)}</div>}
      <div className="oc-tile-row">
        <input className="oc-input" placeholder="Search schools" value={q} disabled={disabled} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { e.preventDefault(); add(matches[0] ? matches[0].name : q.trim()); } }} />
        <OcButton size="sm" disabled={disabled} onClick={() => onAnswer(picked.length ? `Schools I already like: ${picked.join("; ")}` : "None yet")}>{picked.length ? "Continue" : "None yet"}</OcButton>
      </div>
      {matches.length > 0 && <ul className="oc-suggest">{matches.map((c) => <li key={c.id}><button type="button" onClick={() => add(c.name)}>{c.name}</button></li>)}</ul>}
    </div>
  );
}

function OcQuestion({ q, disabled, onAnswer }) {
  if (q.kind === "upload") return <OcUploadTile disabled={disabled} onAnswer={onAnswer} />;
  if (q.kind === "number") return <OcNumberTile q={q} disabled={disabled} onAnswer={onAnswer} />;
  if (q.kind === "school_search") return <OcSchoolSearchTile disabled={disabled} onAnswer={onAnswer} />;
  if (q.kind === "confirm") return <OcConfirmTiles disabled={disabled} onAnswer={onAnswer} />;
  return <OcChoiceTiles q={q} disabled={disabled} onAnswer={onAnswer} />;
}

const OC_TIERS = [["reach", "Reach"], ["target", "Target"], ["likely", "Likely"]];

function OcListTiles({ schools, disabled, onApprove, onRevise }) {
  const [dropped, setDropped] = React.useState([]);
  const [note, setNote] = React.useState("");
  const kept = schools.filter((s) => !dropped.includes(s.name));
  const toggle = (name) => setDropped((d) => (d.includes(name) ? d.filter((x) => x !== name) : [...d, name]));
  return (
    <div className="oc-list">
      {OC_TIERS.map(([tier, label]) => {
        const group = schools.filter((s) => s.tier === tier);
        if (!group.length) return null;
        return (
          <section key={tier} className="oc-list-group">
            <h4 className="oc-list-head">{label} <span>{group.filter((s) => !dropped.includes(s.name)).length}</span></h4>
            <div className="oc-school-grid">
              {group.map((s) => {
                const off = dropped.includes(s.name);
                return (
                  <article key={s.name} className={"oc-school" + (off ? " is-dropped" : "")}>
                    <div className="oc-school-top">
                      <h5>{s.name}</h5>
                      <button type="button" className="oc-link" disabled={disabled} onClick={() => toggle(s.name)}>{off ? "Keep" : "Drop"}</button>
                    </div>
                    <p>{s.reason}</p>
                    <div className="oc-school-meta">
                      {s.estChance && <span>Chance {s.estChance}</span>}
                      {s.netPrice && <span>Net {s.netPrice}{s.fitsBudget === "no" ? " · over budget" : ""}</span>}
                      {s.current && <span>On your list</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      <div className="oc-list-actions">
        <OcButton disabled={disabled || kept.length < 1} onClick={() => onApprove(kept.map((s) => s.name), schools.filter((s) => s.current && dropped.includes(s.name)).map((s) => s.name))}>
          Research these {kept.length}
        </OcButton>
        <input className="oc-input" placeholder="Or ask for changes, e.g. more schools near Boston" value={note} disabled={disabled} onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) { onRevise(note.trim(), dropped); setNote(""); } }} />
      </div>
    </div>
  );
}

function OcStrategyTiles({ strategy, disabled, onConfirm, onAnswer }) {
  return (
    <div className="oc-strategy">
      <dl>
        <div><dt>Early Decision</dt><dd>{strategy.ed || "None"}</dd></div>
        <div><dt>Early Action</dt><dd>{strategy.ea.length ? strategy.ea.join(", ") : "None"}</dd></div>
      </dl>
      <p>{strategy.reasons}</p>
      <div className="oc-tile-grid oc-tile-grid--two">
        <button type="button" className="oc-tile" disabled={disabled} onClick={onConfirm}><span className="oc-tile-label">Sounds right</span><span className="oc-tile-hint">Save these rounds and build my timeline</span></button>
        <button type="button" className="oc-tile" disabled={disabled} onClick={() => onAnswer("I'd like to change the early plan.")}><span className="oc-tile-label">Change something</span><span className="oc-tile-hint">Tell the AI what you'd do differently</span></button>
      </div>
    </div>
  );
}

const OC_STAGE = { queued: "Waiting", searching: "Searching", reading: "Reading sources", saved: "Saving facts", done: "Verified", needs_review: "Needs a second look" };

function OcResearchBoard({ cards }) {
  return (
    <div className="oc-research" aria-live="polite">
      {cards.map((c) => (
        <article key={c.slug} className={"oc-research-card is-" + c.stage}>
          <div className="oc-research-top"><h5>{c.name}</h5><span>{OC_STAGE[c.stage] || c.stage}</span></div>
          <p>{c.facts ? `${c.facts} facts saved` : c.note || " "}</p>
        </article>
      ))}
    </div>
  );
}

Object.assign(window, { OcQuestion, OcListTiles, OcStrategyTiles, OcResearchBoard });
