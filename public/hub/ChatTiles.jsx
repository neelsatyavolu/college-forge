// Tiles the onboarding interview draws from the AI's tool calls: choice questions, the transcript
// upload, numbers, school search, the draft list and the ED/EA strategy. Names are prefixed (oc)
// because hub scripts share one global scope.
const { Button: OcButton } = window.CollegeForgeDesignSystem_e95e63;

/** **bold** and [text](https://…) inside one line. Only http(s) links; everything else stays text. */
function ocInline(text, key) {
  const parts = String(text).split(/(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.map((seg, i) => {
    const k = `${key}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(seg)) return <strong key={k}>{seg.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(seg);
    if (link) return <a key={k} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return seg;
  });
}

/** The AI's Markdown as React elements (no HTML): paragraphs, line breaks, "- " lists, bold, links. */
function ocRich(md) {
  return String(md || "").split(/\n{2,}/).filter((b) => b.trim()).map((block, i) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return <ul key={i} className="oc-rich-list">{lines.map((l, j) => <li key={j}>{ocInline(l.replace(/^\s*[-*•]\s+/, ""), `${i}-${j}`)}</li>)}</ul>;
    }
    return <p key={i} className="oc-rich-p">{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{ocInline(l, `${i}-${j}`)}</React.Fragment>)}</p>;
  });
}

function OcChoiceTiles({ q, disabled, onAnswer }) {
  const multi = q.kind === "multi";
  const [picked, setPicked] = React.useState([]);
  const toggle = (opt) => {
    if (!multi) return onAnswer(opt.label);
    setPicked((p) => (p.includes(opt.label) ? p.filter((x) => x !== opt.label) : [...p, opt.label]));
  };
  const submitMulti = () => {
    if (picked.length) onAnswer(picked.join(", "));
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
      {multi && (
        <div className="oc-tile-row">
          <OcButton size="sm" disabled={disabled || !picked.length} onClick={submitMulti}>Continue{picked.length ? ` with ${picked.length}` : ""}</OcButton>
          <span className="oc-tile-note">Pick all that apply</span>
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

/** onUploaded, when given, receives the saved file names instead of sending a chat answer (the quick-start form sends them with the rest). */
function OcUploadTile({ disabled, onAnswer, onUploaded, compact, title }) {
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
      if (onUploaded) onUploaded(names);
      else onAnswer(`I uploaded ${names.join(", ")}.`);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  return (
    <div>
      <label className={"oc-upload" + (compact ? " oc-upload--compact" : "") + (over ? " is-over" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && !busy) upload(e.dataTransfer.files); }}>
        <input ref={inputRef} type="file" accept=".pdf,.docx,.txt,.md,.markdown,.csv" multiple hidden disabled={disabled || busy} onChange={(e) => upload(e.target.files)} />
        <span className="oc-upload-icon" aria-hidden="true">↑</span>
        <span className="oc-upload-title">{busy ? "Reading your file…" : title || (compact ? "Drop a resume or activities list, or choose a file" : "Drop your transcript here, or choose a file")}</span>
        <span className="oc-upload-hint">PDF, Word, Markdown or text · up to 15 MB</span>
      </label>
      {error && <p className="oc-error" role="alert">{error}</p>}
      {!compact && <button type="button" className="oc-link" disabled={disabled || busy} onClick={() => onAnswer("I don't have my transcript handy. Let's do it by hand.")}>I'll type my grades instead</button>}
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

const OC_MAX_ACTIVITIES = 10;
const OC_MAX_HONORS = 5;
const ocBlankActivity = () => ({ name: "", role: "", years: "", hpw: "" });
const ocBlankHonor = () => ({ title: "", level: "", year: "" });

/**
 * An editable activities and honors list, prefilled from the profile. Saving writes it straight to the
 * profile (same rules as the Profile page), then tells the AI what was saved so it can ask about the
 * ones that matter most. A resume or activities PDF can be uploaded instead for the AI to read.
 */
function OcActivitiesTile({ profile, revision, disabled, onAnswer }) {
  const saved = (profile && profile.activities) || [];
  const savedHonors = (profile && profile.honors) || [];
  // Saved rows first, then empty ones to fill: at least 3 activity rows and 1 honor row.
  const pad = (list, blank, min, max) => [...list, ...Array.from({ length: Math.max(0, Math.min(max, Math.max(min, list.length + 1)) - list.length) }, blank)];
  const [rows, setRows] = React.useState(() => pad(saved.map((a) => ({ ...a, hpw: a.hpw || "" })), ocBlankActivity, 3, OC_MAX_ACTIVITIES));
  const [honors, setHonors] = React.useState(() => pad(savedHonors.map((h) => ({ ...h })), ocBlankHonor, 1, OC_MAX_HONORS));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const edit = (setter, i, key) => (e) => { const v = e.target.value; setter((list) => list.map((r, j) => (j === i ? { ...r, [key]: v } : r))); };
  const remove = (setter, i) => setter((list) => list.filter((_, j) => j !== i));

  const save = async () => {
    const activities = rows.filter((r) => r.name.trim()).map((r, i) => ({ ...r, name: r.name.trim(), role: (r.role || "").trim(), years: (r.years || "").trim(), hpw: String(r.hpw || "").trim(), type: r.type || "", rank: i + 1 }));
    const honorList = honors.filter((h) => h.title.trim()).map((h) => ({ ...h, title: h.title.trim(), level: (h.level || "").trim(), year: (h.year || "").trim() }));
    if (!activities.length && !honorList.length) { setError("Add at least one activity, or tell the AI you don't have any yet."); return; }
    setBusy(true); setError("");
    try {
      await window.cfApi.patch({ profile: { activities, honors: honorList }, ...(Number.isInteger(revision) ? { baseRevision: revision } : {}) });
      const line = (a) => [a.name, a.role, a.years && `grades ${a.years}`, a.hpw && `${a.hpw} hrs/wk`].filter(Boolean).join(", ");
      const honorLine = (h) => [h.title, h.level, h.year].filter(Boolean).join(", ");
      onAnswer([
        `I saved my list: ${activities.length} ${activities.length === 1 ? "activity" : "activities"}${honorList.length ? ` and ${honorList.length} ${honorList.length === 1 ? "honor" : "honors"}` : ""}.`,
        ...activities.map((a, i) => `${i + 1}. ${line(a)}`),
        ...(honorList.length ? ["Honors:", ...honorList.map((h) => `- ${honorLine(h)}`)] : []),
      ].join("\n"));
    } catch (e) {
      setError(e.status === 409 ? "Your profile changed in another tab. Reload and try again." : e.message || "That didn't save. Try again.");
    }
    setBusy(false);
  };

  const off = disabled || busy;
  return (
    <div className="oc-acts">
      <div className="oc-acts-head"><span>Activity</span><span>Your role</span><span>Grades</span><span>Hrs/wk</span><span /></div>
      {rows.map((r, i) => (
        <div className="oc-acts-row" key={"a" + i}>
          <input className="oc-input" aria-label={`Activity ${i + 1}`} placeholder="Robotics team" value={r.name} disabled={off} onChange={edit(setRows, i, "name")} maxLength={200} />
          <input className="oc-input" aria-label={`Role in activity ${i + 1}`} placeholder="Build lead" value={r.role || ""} disabled={off} onChange={edit(setRows, i, "role")} maxLength={200} />
          <input className="oc-input" aria-label={`Grades for activity ${i + 1}`} placeholder="9–12" value={r.years || ""} disabled={off} onChange={edit(setRows, i, "years")} maxLength={40} />
          <input className="oc-input" aria-label={`Hours per week for activity ${i + 1}`} inputMode="numeric" placeholder="8" value={r.hpw || ""} disabled={off} onChange={edit(setRows, i, "hpw")} maxLength={4} />
          <button type="button" className="oc-link" aria-label={`Remove activity ${i + 1}`} disabled={off} onClick={() => remove(setRows, i)}>Remove</button>
        </div>
      ))}
      {rows.length < OC_MAX_ACTIVITIES && <button type="button" className="oc-link oc-acts-add" disabled={off} onClick={() => setRows((l) => [...l, ocBlankActivity()])}>+ Add activity</button>}

      <div className="oc-acts-head oc-acts-head--honors"><span>Award or honor</span><span>Level</span><span>Year</span><span /></div>
      {honors.map((h, i) => (
        <div className="oc-acts-row oc-acts-row--honor" key={"h" + i}>
          <input className="oc-input" aria-label={`Honor ${i + 1}`} placeholder="AP Scholar with Distinction" value={h.title} disabled={off} onChange={edit(setHonors, i, "title")} maxLength={200} />
          <input className="oc-input" aria-label={`Level of honor ${i + 1}`} placeholder="School, State, National…" value={h.level || ""} disabled={off} onChange={edit(setHonors, i, "level")} maxLength={40} />
          <input className="oc-input" aria-label={`Year of honor ${i + 1}`} placeholder="11" value={h.year || ""} disabled={off} onChange={edit(setHonors, i, "year")} maxLength={40} />
          <button type="button" className="oc-link" aria-label={`Remove honor ${i + 1}`} disabled={off} onClick={() => remove(setHonors, i)}>Remove</button>
        </div>
      ))}
      {honors.length < OC_MAX_HONORS && <button type="button" className="oc-link oc-acts-add" disabled={off} onClick={() => setHonors((l) => [...l, ocBlankHonor()])}>+ Add honor</button>}

      <div className="oc-tile-row oc-acts-actions">
        <OcButton size="sm" disabled={off} onClick={save}>{busy ? "Saving…" : "Save my list"}</OcButton>
        <span className="oc-tile-note">Up to {OC_MAX_ACTIVITIES} activities and {OC_MAX_HONORS} honors, like the Common App. Rough is fine.</span>
      </div>
      {error && <p className="oc-error" role="alert">{error}</p>}
      <p className="oc-acts-or">Have a resume or activities list already?</p>
      <OcUploadTile disabled={off} onAnswer={(msg) => onAnswer(`${msg} It has my activities and awards; please read it and fill in my list.`)} compact />
    </div>
  );
}

function OcQuestionBody({ q, data, profile, revision, disabled, onAnswer }) {
  if (q.kind === "intake") return <window.OcIntakeTile data={data} disabled={disabled} onAnswer={onAnswer} />;
  if (q.kind === "activities") return <OcActivitiesTile profile={profile} revision={revision} disabled={disabled} onAnswer={onAnswer} />;
  if (q.kind === "upload") return <OcUploadTile disabled={disabled} onAnswer={onAnswer} />;
  if (q.kind === "number") return <OcNumberTile q={q} disabled={disabled} onAnswer={onAnswer} />;
  if (q.kind === "school_search") return <OcSchoolSearchTile disabled={disabled} onAnswer={onAnswer} />;
  if (q.kind === "confirm") return <OcConfirmTiles disabled={disabled} onAnswer={onAnswer} />;
  return <OcChoiceTiles q={q} disabled={disabled} onAnswer={onAnswer} />;
}

const ocNorm = (t) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The question itself, then its tiles. The prompt is skipped when the message above already says it. */
function OcQuestion({ q, lead, data, profile, revision, disabled, onAnswer }) {
  const said = q.prompt && ocNorm(lead).includes(ocNorm(q.prompt));
  return (
    <div className="oc-question">
      {!said && <p className="oc-question-prompt">{q.prompt}</p>}
      <OcQuestionBody q={q} data={data} profile={profile} revision={revision} disabled={disabled} onAnswer={onAnswer} />
    </div>
  );
}

const OC_TIER_LABEL = { reach: "Reach", target: "Target", likely: "Likely" };
const OC_TIER_ORDER = { reach: 0, target: 1, likely: 2 };
const ocIsUc = (s) => /\buniversity of california\b|^uc[ -]/i.test(s.name);

/** Counts applications the way schools are applied to: every UC campus together is one. */
function ocAppCount(list) {
  const uc = list.some(ocIsUc);
  return list.filter((s) => !ocIsUc(s)).length + (uc ? 1 : 0);
}

function OcSchoolTile({ s, off, disabled, onToggle }) {
  return (
    <article className={"oc-school" + (off ? " is-dropped" : "")}>
      <div className="oc-school-top">
        <h5>{s.name}</h5>
        <button type="button" className="oc-link" disabled={disabled} onClick={onToggle}>{off ? "Keep" : "Drop"}</button>
      </div>
      <div className="oc-school-tags">
        <span className={"oc-tier oc-tier--" + s.tier}>{OC_TIER_LABEL[s.tier]}</span>
        {s.aiTier && s.aiTier !== s.tier && <span className="oc-tier-note" title="Forge sets tiers from published admissions data for your GPA and scores">Forge's data</span>}
        {s.round && <span className="oc-round" title="Planned round; confirmed after research">{s.round}</span>}
        {s.current && <span className="oc-tier-note">On your list</span>}
      </div>
      <p>{ocInline(s.reason, "r")}</p>
      <div className="oc-school-meta">
        {s.estChance && <span>Chance {s.estChance}</span>}
        {s.netPrice && <span>Net {s.netPrice}{s.fitsBudget === "no" ? " · over budget" : ""}</span>}
      </div>
    </article>
  );
}

function OcListTiles({ schools, edIdea, transferPath, warning, disabled, onApprove, onRevise }) {
  const [dropped, setDropped] = React.useState([]);
  const [note, setNote] = React.useState("");
  const kept = schools.filter((s) => !dropped.includes(s.name));
  const toggle = (name) => setDropped((d) => (d.includes(name) ? d.filter((x) => x !== name) : [...d, name]));
  const sorted = (list) => [...list].sort((a, b) => OC_TIER_ORDER[a.tier] - OC_TIER_ORDER[b.tier]);
  const groups = [
    ["Write supplements", "Essays for each school (all UC campuses share one set)", sorted(schools.filter((s) => s.supplements !== "no"))],
    ["No supplements", "Common App or school application only", sorted(schools.filter((s) => s.supplements === "no"))],
  ];
  const mix = ["reach", "target", "likely"].map((t) => `${kept.filter((s) => s.tier === t).length} ${OC_TIER_LABEL[t].toLowerCase()}`).join(" · ");
  return (
    <div className="oc-list">
      {edIdea && (
        <div className="oc-ed-idea">
          <span className="oc-ed-label">Early Decision idea</span>
          <strong>{edIdea.school || "None for now"}</strong>
          <p>{ocInline(edIdea.reason, "e")}</p>
        </div>
      )}
      {warning && <p className="oc-list-warn" role="note">{warning}</p>}
      <p className="oc-list-mix">{ocAppCount(kept)} applications · {mix}</p>
      {groups.map(([title, hint, group]) => group.length > 0 && (
        <section key={title} className="oc-list-group">
          <h4 className="oc-list-head">{title} <span>{ocAppCount(group.filter((s) => !dropped.includes(s.name)))}</span><em>{hint}</em></h4>
          <div className="oc-school-grid">
            {group.map((s) => <OcSchoolTile key={s.name} s={s} off={dropped.includes(s.name)} disabled={disabled} onToggle={() => toggle(s.name)} />)}
          </div>
        </section>
      ))}
      {transferPath && (
        <div className="oc-ed-idea oc-transfer">
          <span className="oc-ed-label">Backup path: start at community college</span>
          <strong>{transferPath.college} → {transferPath.transfersTo}</strong>
          <p>{ocInline(transferPath.reason, "t")}</p>
        </div>
      )}
      <div className="oc-list-actions">
        <OcButton disabled={disabled || kept.length < 1} onClick={() => onApprove(kept.map((s) => s.name), schools.filter((s) => s.current && dropped.includes(s.name)).map((s) => s.name))}>
          Research these {kept.length}
        </OcButton>
        <input className="oc-input" placeholder="Or ask for changes, e.g. more journalism schools on the East Coast" value={note} disabled={disabled} onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) { onRevise(note.trim(), dropped); setNote(""); } }} />
      </div>
    </div>
  );
}

const OC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ocShortDate = (iso) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${OC_MONTHS[Number(m[1]) - 1]} ${Number(m[2])}` : ""; };

/** Every school's recommended round, grouped by round and ordered by deadline. */
function OcRoundList({ rounds }) {
  const groups = new Map();
  for (const r of [...rounds].sort((a, b) => (a.deadline || "9").localeCompare(b.deadline || "9"))) {
    if (!groups.has(r.round)) groups.set(r.round, []);
    groups.get(r.round).push(r);
  }
  return (
    <div className="oc-rounds">
      {[...groups].map(([round, list]) => (
        <div key={round} className="oc-rounds-group">
          <h5>{round} <span>{list.length}</span></h5>
          <ul>{list.map((r) => <li key={r.school}><span>{r.school}</span>{r.deadline && <em>{ocShortDate(r.deadline)}</em>}</li>)}</ul>
        </div>
      ))}
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
      {strategy.rounds && strategy.rounds.length > 0 && <OcRoundList rounds={strategy.rounds} />}
      <div>{ocRich(strategy.reasons)}</div>
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
          <p>{[c.facts ? `${c.facts} facts saved` : c.note, c.round].filter(Boolean).join(" · ") || " "}</p>
        </article>
      ))}
    </div>
  );
}

Object.assign(window, { ocRich, OcUploadTile, OcQuestion, OcListTiles, OcStrategyTiles, OcResearchBoard });
