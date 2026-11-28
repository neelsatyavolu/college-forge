// The quick-start form at the beginning of the onboarding interview: everything Forge needs in one
// place, every field optional, every choice with a "Not sure". Saving writes the profile directly and
// tells the AI what was filled and what wasn't, so the interview only asks about the gaps. Students
// can instead paste a summary their own AI wrote about them, or upload files.
const { Button: IkButton } = window.CollegeForgeDesignSystem_e95e63;

const IK_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI".split(" ");

/** The prompt a student copies into ChatGPT, Claude or another assistant that knows them. */
const IK_AGENT_PROMPT = `I'm setting up my college applications in Forge. Using everything you know about me from our past conversations, files and memory, write a profile summary I can paste in. Use these headings and keep it under 900 words. Write "unknown" for anything you don't know; don't guess.

Basics: name, high school, city and state, graduation year, citizenship.
Academics: unweighted and weighted GPA, grades by year if you know them (to show a trend), class rank, hardest courses (AP/IB/honors/dual enrollment) and grades in them, SAT/ACT scores and sections, AP exam scores.
Intended major(s) and why; careers I've talked about.
Activities: each one with my role, grades involved, hours per week, and what I actually did or achieved.
Awards and honors: name, level (school/regional/state/national), year.
Family and money: whether I'd be the first in my family to attend college, rough family income range, what my family can pay per year, whether we'd apply for need-based aid.
College preferences: size, setting, regions, weather, distance from home, anything I said I wanted or wanted to avoid, colleges I've mentioned.
Personality and story: what drives me, challenges I've faced, things I'm proud of, how I spend free time, how people describe me.
Plans: how many colleges I want to apply to, Early Decision thoughts, deadlines I've mentioned.`;

const IK_CHOICES = {
  citizenship: [["us", "US citizen"], ["permanent", "Permanent resident"], ["international", "International"], ["unsure", "Not sure"]],
  gpaScale: [["4.0", "4.0"], ["4.33", "4.33 (A+ above 4.0)"], ["100-point", "100-point"], ["other", "Something else"], ["", "Not sure"]],
  gpaTrend: [["up", "Going up"], ["steady", "Steady"], ["down", "Going down"], ["", "Not sure"]],
  incomeBracket: [["lt30", "Under $30k"], ["30-48", "$30–48k"], ["48-75", "$48–75k"], ["75-110", "$75–110k"], ["gt110", "Over $110k"], ["unsure", "Not sure"]],
  budget: [["lt15", "Under $15k"], ["15-30", "$15–30k"], ["30-50", "$30–50k"], ["50plus", "$50k+"], ["unsure", "Not sure"]],
  needAid: [["yes", "Yes"], ["no", "No"], ["", "Not sure"]],
  firstGen: [["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]],
  ambition: [["ambitious", "More reaches"], ["balanced", "Balanced"], ["conservative", "More likely schools"], ["", "Not sure"]],
  ed: [["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]],
  settings: [["urban", "City"], ["suburban", "Suburban"], ["college-town", "College town"], ["rural", "Rural"], ["any", "Any"]],
  size: [["small", "Small (<5k)"], ["medium", "Medium (5–15k)"], ["large", "Large (15k+)"], ["any", "Any"]],
  regions: [["west", "West"], ["midwest", "Midwest"], ["south", "South"], ["mid-atlantic", "Mid-Atlantic"], ["northeast", "New England"], ["any", "Anywhere"]],
};

/** Pick-several chips; "any" clears the others. */
function IkMultiChips({ name, value, onChange, disabled }) {
  const list = value || [];
  const toggle = (v) => onChange(v === "any" ? (list.includes("any") ? [] : ["any"]) : list.includes(v) ? list.filter((x) => x !== v) : [...list.filter((x) => x !== "any"), v]);
  return (
    <div className="ik-chips" role="group" aria-label={name}>
      {IK_CHOICES[name].map(([v, label]) => (
        <button key={v} type="button" className="ik-chip" aria-pressed={list.includes(v)} disabled={disabled} onClick={() => toggle(v)}>{label}</button>
      ))}
    </div>
  );
}

/** Suggested counts by mix, for students who don't know how many schools to apply to. */
const IK_RECOMMENDED = { ambitious: [9, 3], balanced: [8, 3], conservative: [6, 4], "": [8, 3] };

function IkChips({ name, value, onChange, disabled }) {
  return (
    <div className="ik-chips" role="group" aria-label={name}>
      {IK_CHOICES[name].map(([v, label]) => (
        <button key={v + label} type="button" className="ik-chip" aria-pressed={value === v} disabled={disabled} onClick={() => onChange(value === v ? undefined : v)}>{label}</button>
      ))}
    </div>
  );
}

/**
 * A labeled field. Chip rows pass `group`: a <label> forwards any click on its text or the gaps
 * between chips to the first chip, which then looked selected next to the student's real pick.
 */
function IkField({ label, hint, children, wide, group }) {
  const className = "ik-field" + (wide ? " ik-field--wide" : "");
  const caption = <span className="ik-label">{label}{hint && <em>{hint}</em>}</span>;
  if (group) return <div className={className} role="group" aria-label={label}>{caption}{children}</div>;
  return <label className={className}>{caption}{children}</label>;
}

const ikStr = (v) => (v === undefined || v === null || v === "—" ? "" : String(v));

function ikInitial(data) {
  const a = (data && data.applicant) || {};
  const p = (data && data.profile) || {};
  const lp = (data && data.onboarding && data.onboarding.listPrefs) || {};
  const t = p.testing || {};
  return {
    name: ikStr(a.name), gradYear: ikStr(p.gradYear), hs: ikStr(p.hs), residency: ikStr(p.residency), citizenship: lp.citizenship,
    gpaUnweighted: ikStr(a.gpaUnweighted), gpaWeighted: ikStr(a.gpaWeighted), gpaRecent: ikStr(a.gpaRecent), gpaTrend: a.gpaTrend,
    gpaScale: ["4.0", "4.33", "100-point"].includes(a.gpaScale) ? a.gpaScale : a.gpaScale ? "other" : undefined,
    gpa9: ikStr((a.gpaByYear || {})["9"]), gpa10: ikStr((a.gpaByYear || {})["10"]), gpa11: ikStr((a.gpaByYear || {})["11"]),
    sat: ikStr(t.sat || a.sat), act: ikStr(t.act), testOptional: /optional|not submit/i.test(t.satNote || a.satNote || ""),
    intended: ikStr(p.intended),
    incomeBracket: lp.incomeBracket, budget: lp.budget, needAid: lp.needAid === true ? "yes" : lp.needAid === false ? "no" : undefined, firstGen: lp.firstGen,
    ambition: lp.ambitionChosen ? lp.ambition : undefined,
    suppCount: lp.suppCount === undefined ? "" : String(lp.suppCount), noSuppCount: lp.noSuppCount === undefined ? "" : String(lp.noSuppCount),
    recommendCounts: false, ed: lp.ed,
    settings: lp.settings || [], size: lp.size && lp.size !== "any" ? lp.size : lp.size === "any" && (lp.settings || []).length ? "any" : undefined, regions: lp.regions || [], campusNotes: "",
    activities: ((p.activities) || []).map((a) => [a.name, a.role].filter(Boolean).join(", ")).join("\n"), likedSchools: "",
  };
}

/** The patch the form saves, and a readable summary of what was given and what was left blank. */
function ikBuild(f) {
  const num = (v, max) => (/^\d+(\.\d+)?$/.test(String(v).trim()) && Number(v) <= max ? String(v).trim() : "");
  const label = (k, v) => (IK_CHOICES[k].find(([x]) => x === v) || [, v])[1];
  // GPAs go straight to the profile only on a 4.0 scale. On any other scale (or an unknown one) they
  // go to the AI as typed, which converts them to 4.0 unweighted (lib/gpa-scale.ts) before saving.
  const onFour = f.gpaScale === "4.0";
  const years = [["9", f.gpa9], ["10", f.gpa10], ["11", f.gpa11]];
  const applicant = {
    ...(f.name.trim() ? { name: f.name.trim() } : {}),
    ...(f.gpaScale && f.gpaScale !== "other" ? { gpaScale: f.gpaScale } : {}),
    ...(onFour && num(f.gpaUnweighted, 4) ? { gpaUnweighted: num(f.gpaUnweighted, 4) } : {}),
    ...(num(f.gpaWeighted, 6) ? { gpaWeighted: num(f.gpaWeighted, 6) } : {}),
    ...(onFour && num(f.gpaRecent, 4) ? { gpaRecent: num(f.gpaRecent, 4) } : {}),
    ...(f.gpaTrend ? { gpaTrend: f.gpaTrend } : {}),
    ...(onFour && years.some(([, v]) => num(v, 4))
      ? { gpaByYear: Object.fromEntries(years.filter(([, v]) => num(v, 4)).map(([y, v]) => [y, num(v, 4)])) }
      : {}),
  };
  const raw = onFour ? [] : [["unweighted", f.gpaUnweighted], ["weighted", f.gpaWeighted], ["9th grade", f.gpa9], ["10th grade", f.gpa10], ["11th grade", f.gpa11], ["10th–11th", f.gpaRecent]]
    .filter(([k, v]) => num(v, 100) && !(k === "weighted" && applicant.gpaWeighted)).map(([k, v]) => `${k} ${num(v, 100)}`);
  const rawGpa = raw.length ? `GPA as my school reports it (${f.gpaScale && f.gpaScale !== "other" ? `${label("gpaScale", f.gpaScale)} scale` : f.gpaScale === "other" ? "a different scale; please ask me which" : "scale not given; please ask me"}): ${raw.join(", ")}. Please convert to 4.0 unweighted before saving.` : "";
  const testing = f.testOptional
    ? { satNote: "Test optional" }
    : { ...(num(f.sat, 1600) && Number(f.sat) >= 400 ? { sat: num(f.sat, 1600) } : {}), ...(num(f.act, 36) ? { act: num(f.act, 36) } : {}) };
  const profile = {
    ...(f.hs.trim() ? { hs: f.hs.trim() } : {}),
    ...(/^\d{4}$/.test(f.gradYear.trim()) ? { gradYear: Number(f.gradYear.trim()) } : {}),
    ...(f.residency && f.residency !== "INTL" ? { residency: f.residency } : {}),
    ...(f.intended.trim() ? { intended: f.intended.trim() } : {}),
    ...(Object.keys(testing).length ? { testing } : {}),
  };
  const [recSupp, recQuick] = IK_RECOMMENDED[f.ambition || ""];
  const supp = f.recommendCounts ? recSupp : /^\d{1,2}$/.test(f.suppCount.trim()) ? Number(f.suppCount) : undefined;
  const quick = f.recommendCounts ? recQuick : /^\d{1,2}$/.test(f.noSuppCount.trim()) ? Number(f.noSuppCount) : undefined;
  const listPrefs = {
    ...(f.citizenship ? { citizenship: f.residency === "INTL" && f.citizenship === "unsure" ? "international" : f.citizenship } : f.residency === "INTL" ? { citizenship: "international" } : {}),
    ...(f.incomeBracket ? { incomeBracket: f.incomeBracket } : {}),
    ...(f.budget ? { budget: f.budget } : {}),
    ...(f.needAid === "yes" || f.needAid === "no" ? { needAid: f.needAid === "yes" } : {}),
    ...(f.firstGen ? { firstGen: f.firstGen } : {}),
    ...(f.ambition ? { ambition: f.ambition } : {}),
    ...(supp !== undefined ? { suppCount: supp } : {}),
    ...(quick !== undefined ? { noSuppCount: quick } : {}),
    ...(f.recommendCounts ? { countsRecommended: true } : {}),
    ...(f.ed ? { ed: f.ed } : {}),
    ...(f.settings.length ? { settings: f.settings } : {}),
    ...(f.size ? { size: f.size } : {}),
    ...(f.regions.length ? { regions: f.regions } : {}),
    ...(f.campusNotes.trim() ? { notes: f.campusNotes.trim().slice(0, 1000) } : {}),
  };
  const said = [
    applicant.name && `Name: ${applicant.name}`, profile.hs && `High school: ${profile.hs}`, profile.gradYear && `Class of ${profile.gradYear}`,
    f.residency && `State: ${f.residency === "INTL" ? "outside the US" : f.residency}`, listPrefs.citizenship && `Citizenship: ${label("citizenship", listPrefs.citizenship)}`,
    applicant.gpaScale && `Grading scale: ${label("gpaScale", applicant.gpaScale)}`,
    applicant.gpaUnweighted && `Unweighted GPA ${applicant.gpaUnweighted}`, applicant.gpaWeighted && `weighted ${applicant.gpaWeighted}`, rawGpa,
    applicant.gpaRecent && `10th–11th GPA ${applicant.gpaRecent}`, applicant.gpaTrend && `Grades ${label("gpaTrend", applicant.gpaTrend).toLowerCase()}`,
    f.testOptional ? "Applying test-optional" : [testing.sat && `SAT ${testing.sat}`, testing.act && `ACT ${testing.act}`].filter(Boolean).join(", "),
    profile.intended && `Interested in: ${profile.intended}`,
    listPrefs.incomeBracket && `Family income: ${label("incomeBracket", listPrefs.incomeBracket)}`, listPrefs.budget && (listPrefs.budget === "unsure" ? "Budget: not sure" : `Budget: ${label("budget", listPrefs.budget)} a year`),
    listPrefs.needAid !== undefined && `Need-based aid: ${listPrefs.needAid ? "yes" : "no"}`, listPrefs.firstGen && `First-gen: ${label("firstGen", listPrefs.firstGen)}`,
    listPrefs.ambition && `Mix: ${label("ambition", listPrefs.ambition)}`,
    supp !== undefined && `${supp} schools with supplements and ${quick} without${f.recommendCounts ? " (Forge's suggestion; I wasn't sure)" : ""}`,
    listPrefs.ed && `Early Decision: ${listPrefs.ed}`,
    listPrefs.settings && `Campus setting: ${listPrefs.settings.map((v) => label("settings", v)).join(", ")}`,
    listPrefs.size && `Size: ${label("size", listPrefs.size)}`,
    listPrefs.regions && `Regions: ${listPrefs.regions.map((v) => label("regions", v)).join(", ")}`,
    listPrefs.notes && `Also matters: ${listPrefs.notes}`,
    f.likedSchools.trim() && `Schools I already like: ${f.likedSchools.trim()}`,
    f.activities.trim() && `Activities and awards (one per line; please save each):\n${f.activities.trim().split("\n").map((l) => `  · ${l.trim()}`).filter((l) => l.length > 4).join("\n")}`,
  ].filter(Boolean);
  const blanks = [
    !applicant.gpaUnweighted && !applicant.gpaWeighted && !rawGpa && "GPA", !f.testOptional && !testing.sat && !testing.act && "test scores",
    !profile.intended && "intended major", !listPrefs.incomeBracket && "family income", !listPrefs.budget && "budget",
    listPrefs.needAid === undefined && "need-based aid", !listPrefs.ambition && "list mix", supp === undefined && "how many schools", !listPrefs.ed && "Early Decision",
    !listPrefs.settings && !listPrefs.regions && "campus preferences", !f.activities.trim() && "activities",
  ].filter(Boolean);
  return { patch: { applicant, profile, listPrefs }, said, blanks };
}

function IkAgentPaste({ disabled, onAnswer }) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [text, setText] = React.useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(IK_AGENT_PROMPT); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch (e) { setOpen(true); }
  };
  return (
    <div className="ik-agent">
      <div className="ik-agent-row">
        <div>
          <strong>Have an AI that knows you?</strong>
          <p>Copy this prompt into ChatGPT, Claude or another assistant, then paste its summary here. Forge fills in what it can and asks about the rest.</p>
        </div>
        <div className="ik-agent-actions">
          <IkButton size="sm" variant="secondary" disabled={disabled} onClick={copy}>{copied ? "Copied" : "Copy prompt"}</IkButton>
          <button type="button" className="oc-link" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Paste a summary"}</button>
        </div>
      </div>
      {open && (
        <div className="ik-agent-paste">
          <details><summary>See the prompt</summary><pre className="ik-prompt">{IK_AGENT_PROMPT}</pre></details>
          <textarea className="oc-input" rows={6} maxLength={7000} placeholder="Paste what your AI wrote about you" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
          <IkButton size="sm" disabled={disabled || text.trim().length < 40} onClick={() => onAnswer(`Here's a profile summary my AI wrote about me. Please save everything you can from it, then ask me only about what's missing:\n\n${text.trim()}`)}>Use this summary</IkButton>
        </div>
      )}
    </div>
  );
}

/**
 * A half-filled form survives "Save and exit", a reload or a closed tab: it is kept in this browser's
 * localStorage under the workspace's key (sessionStorage would lose it when the tab closes, which is
 * exactly when a student comes back later) and removed once the form is sent.
 */
const ikDraftKey = (data) => "cf.intake-draft." + ((data && data.draftStorageKey) || "local");
function ikLoadDraft(data) {
  try {
    const saved = JSON.parse(localStorage.getItem(ikDraftKey(data)) || "null");
    return saved && typeof saved === "object" && saved.f && typeof saved.f === "object" ? saved : null;
  } catch (e) { return null; }
}
function ikSaveDraft(data, draft) {
  try { localStorage.setItem(ikDraftKey(data), JSON.stringify(draft)); } catch (e) { /* private mode: the form still works */ }
}
function ikClearDraft(data) {
  try { localStorage.removeItem(ikDraftKey(data)); } catch (e) { /* nothing stored */ }
}

function OcIntakeTile({ data, disabled, onAnswer }) {
  const restored = React.useMemo(() => ikLoadDraft(data), []);
  const [f, setF] = React.useState(() => {
    const base = ikInitial(data);
    // Only keys the form knows, with the same type as the fresh form, so an old or edited draft can't break it.
    const saved = restored ? Object.fromEntries(Object.entries(restored.f).filter(([k, v]) => k in base && (base[k] === undefined || typeof v === typeof base[k]))) : {};
    return { ...base, ...saved };
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  /** Files uploaded from this form: sent with the rest when the student saves, never on their own. */
  const [files, setFiles] = React.useState(() => (restored && Array.isArray(restored.files) ? restored.files.filter((x) => x && typeof x.name === "string" && typeof x.slot === "string") : []));
  const touched = React.useRef(Boolean(restored));
  React.useEffect(() => { if (touched.current) ikSaveDraft(data, { f, files }); }, [f, files]);
  const [showYears, setShowYears] = React.useState(() => Boolean(f.gpa9 || f.gpa10 || f.gpa11 || f.gpaRecent));
  /** Each upload box lists only its own files: [{ name, slot }]. */
  const attachedTitle = (slot, fallback) => {
    const mine = files.filter((x) => x.slot === slot).map((x) => x.name);
    return mine.length ? `Attached ${mine.join(", ")}. Add more?` : fallback;
  };
  const addFiles = (slot) => (names) => { touched.current = true; setFiles((x) => [...x.filter((y) => !names.includes(y.name)), ...names.map((name) => ({ name, slot }))]); };
  const set = (k) => (v) => { touched.current = true; setF((x) => ({ ...x, [k]: v && v.target ? (v.target.type === "checkbox" ? v.target.checked : v.target.value) : v })); };
  const off = disabled || busy;

  const save = async () => {
    const { patch, said, blanks } = ikBuild(f);
    if (!said.length && !files.length) { setError("Fill in anything you know, or use one of the other ways above."); return; }
    setBusy(true); setError("");
    try {
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => Object.keys(v).length));
      if (Object.keys(clean).length) await window.cfApi.patch({ ...clean, ...(Number.isInteger(data && data.revision) ? { baseRevision: data.revision } : {}) });
      const upload = files.length ? [`I uploaded ${files.map((x) => x.name).join(", ")}. They have my grades, activities or other details; please read them and fill in what you can.`] : [];
      const form = said.length ? [`I filled in the quick start:`, ...said.map((s) => `- ${s}`), ...(blanks.length ? [`Not sure / left blank: ${blanks.join(", ")}.`] : [])] : [];
      // The draft goes only once the AI has the answer; if that turn fails, the form comes back filled in.
      const sent = await onAnswer([...upload, ...(upload.length && form.length ? [""] : []), ...form].join("\n"));
      if (sent) { touched.current = false; ikClearDraft(data); }
    } catch (e) {
      setError(e.status === 409 ? "Your profile changed in another tab. Reload and try again." : e.message || "That didn't save. Try again.");
    }
    setBusy(false);
  };

  return (
    <div className="ik">
      <IkAgentPaste disabled={off} onAnswer={onAnswer} />
      <p className="ik-or">Or fill in what you know. Skip anything you're not sure about, and upload files right where they fit.</p>

      <fieldset className="ik-group"><legend>You</legend>
        <div className="ik-grid">
          <IkField label="Name"><input className="oc-input" value={f.name} disabled={off} onChange={set("name")} maxLength={120} /></IkField>
          <IkField label="Class of"><input className="oc-input" inputMode="numeric" placeholder="2027" value={f.gradYear} disabled={off} onChange={set("gradYear")} maxLength={4} /></IkField>
          <IkField label="High school"><input className="oc-input" value={f.hs} disabled={off} onChange={set("hs")} maxLength={160} /></IkField>
          <IkField label="State">
            <select className="oc-input" value={f.residency} disabled={off} onChange={set("residency")}>
              <option value="">Choose</option>{IK_STATES.map((s) => <option key={s} value={s}>{s}</option>)}<option value="INTL">Outside the US</option>
            </select>
          </IkField>
          <IkField label="Citizenship" wide group><IkChips name="citizenship" value={f.citizenship} disabled={off} onChange={set("citizenship")} /></IkField>
        </div>
      </fieldset>

      <fieldset className="ik-group"><legend>Grades and tests</legend>
        <div className="ik-grid">
          <IkField label="Your school's grading scale" hint="your transcript's grade key shows it" wide group><IkChips name="gpaScale" value={f.gpaScale} disabled={off} onChange={set("gpaScale")} /></IkField>
          <IkField label="Unweighted GPA" hint="as on your transcript"><input className="oc-input" inputMode="decimal" value={f.gpaUnweighted} disabled={off} onChange={set("gpaUnweighted")} maxLength={4} /></IkField>
          <IkField label="Weighted GPA"><input className="oc-input" inputMode="decimal" value={f.gpaWeighted} disabled={off} onChange={set("gpaWeighted")} maxLength={4} /></IkField>
          <div className="ik-field ik-field--wide">
            <button type="button" className="oc-link ik-disclose" aria-expanded={showYears} aria-controls="ik-gpa-years" onClick={() => setShowYears((s) => !s)}>
              {showYears ? "Hide grades by year" : "Grades by year (optional)"}
            </button>
          </div>
          {showYears && (
            <div className="ik-grid ik-field--wide ik-subgrid" id="ik-gpa-years">
              <IkField label="9th grade GPA" hint="unweighted, if you know it"><input className="oc-input" inputMode="decimal" value={f.gpa9} disabled={off} onChange={set("gpa9")} maxLength={4} /></IkField>
              <IkField label="10th grade GPA" hint="unweighted"><input className="oc-input" inputMode="decimal" value={f.gpa10} disabled={off} onChange={set("gpa10")} maxLength={4} /></IkField>
              <IkField label="11th grade GPA" hint="unweighted"><input className="oc-input" inputMode="decimal" value={f.gpa11} disabled={off} onChange={set("gpa11")} maxLength={4} /></IkField>
              <IkField label="10th–11th GPA" hint="unweighted, if you know it"><input className="oc-input" inputMode="decimal" value={f.gpaRecent} disabled={off} onChange={set("gpaRecent")} maxLength={4} /></IkField>
            </div>
          )}
          <IkField label="SAT"><input className="oc-input" inputMode="numeric" value={f.sat} disabled={off || f.testOptional} onChange={set("sat")} maxLength={4} /></IkField>
          <IkField label="ACT"><input className="oc-input" inputMode="numeric" value={f.act} disabled={off || f.testOptional} onChange={set("act")} maxLength={2} /></IkField>
          <label className="ik-check"><input type="checkbox" checked={f.testOptional} disabled={off} onChange={set("testOptional")} /> Not sending scores</label>
          <IkField label="My grades are" wide group><IkChips name="gpaTrend" value={f.gpaTrend} disabled={off} onChange={set("gpaTrend")} /></IkField>
        </div>
        <window.OcUploadTile compact title={attachedTitle("grades", "Or just upload your transcripts")} disabled={off} onAnswer={onAnswer} onUploaded={addFiles("grades")} />
      </fieldset>

      <fieldset className="ik-group"><legend>What you want to study</legend>
        <IkField label="Majors you're considering" hint="or Undecided" wide><input className="oc-input" placeholder="Economics, maybe computer science" value={f.intended} disabled={off} onChange={set("intended")} maxLength={200} /></IkField>
      </fieldset>

      <fieldset className="ik-group"><legend>Campus</legend>
        <div className="ik-grid">
          <IkField label="Setting" hint="pick any" wide group><IkMultiChips name="settings" value={f.settings} disabled={off} onChange={set("settings")} /></IkField>
          <IkField label="Size" wide group><IkChips name="size" value={f.size} disabled={off} onChange={set("size")} /></IkField>
          <IkField label="Regions" hint="pick any" wide group><IkMultiChips name="regions" value={f.regions} disabled={off} onChange={set("regions")} /></IkField>
          <IkField label="Anything else that matters" hint="optional" wide><input className="oc-input" placeholder="Strong student newspaper, near home, warm weather…" value={f.campusNotes} disabled={off} onChange={set("campusNotes")} maxLength={300} /></IkField>
          <IkField label="Schools you already like" hint="optional" wide><input className="oc-input" placeholder="Northwestern, UCLA…" value={f.likedSchools} disabled={off} onChange={set("likedSchools")} maxLength={300} /></IkField>
        </div>
      </fieldset>

      <fieldset className="ik-group"><legend>Activities and awards</legend>
        <IkField label="One per line: what it is, your role, grades, hours a week" hint="rough is fine" wide>
          <textarea className="oc-input" rows={4} placeholder={"Student news show, co-executive producer, 9–12, 10 hrs/wk\nRegional journalism award, 2026"} value={f.activities} disabled={off} onChange={set("activities")} maxLength={2000} />
        </IkField>
        <window.OcUploadTile compact title={attachedTitle("activities", "Or just upload your resume or activities list")} disabled={off} onAnswer={onAnswer} onUploaded={addFiles("activities")} />
      </fieldset>

      <fieldset className="ik-group"><legend>Money</legend>
        <p className="ik-note">Colleges price by family income, so this is how Forge estimates what each school would really cost you. It's saved in your Forge workspace and shared with the AI you connected (ChatGPT or Grok) so it can build your list.</p>
        <div className="ik-grid">
          <IkField label="Family income per year" wide group><IkChips name="incomeBracket" value={f.incomeBracket} disabled={off} onChange={set("incomeBracket")} /></IkField>
          <IkField label="What your family can pay per year" wide group><IkChips name="budget" value={f.budget} disabled={off} onChange={set("budget")} /></IkField>
          <IkField label="Applying for need-based aid?" group><IkChips name="needAid" value={f.needAid} disabled={off} onChange={set("needAid")} /></IkField>
          <IkField label="First in your family to go to college?" group><IkChips name="firstGen" value={f.firstGen} disabled={off} onChange={set("firstGen")} /></IkField>
        </div>
      </fieldset>

      <fieldset className="ik-group"><legend>Your list</legend>
        <div className="ik-grid">
          <IkField label="Mix of schools" wide group><IkChips name="ambition" value={f.ambition} disabled={off} onChange={set("ambition")} /></IkField>
          <IkField label="Schools with supplement essays" hint="all UCs = 1"><input className="oc-input" inputMode="numeric" placeholder="6–10" value={f.recommendCounts ? "" : f.suppCount} disabled={off || f.recommendCounts} onChange={set("suppCount")} maxLength={2} /></IkField>
          <IkField label="Quick apps, no supplements"><input className="oc-input" inputMode="numeric" placeholder="2–5" value={f.recommendCounts ? "" : f.noSuppCount} disabled={off || f.recommendCounts} onChange={set("noSuppCount")} maxLength={2} /></IkField>
          <label className="ik-check"><input type="checkbox" checked={f.recommendCounts} disabled={off} onChange={set("recommendCounts")} /> Not sure: recommend for me</label>
          <IkField label="Early Decision (binding)?" wide group><IkChips name="ed" value={f.ed} disabled={off} onChange={set("ed")} /></IkField>
        </div>
      </fieldset>

      {files.length > 0 && (
        <div className="oc-chips" aria-label="Attached files">
          {files.map(({ name: n }) => <button key={n} type="button" className="oc-chip" disabled={off} onClick={() => setFiles((x) => x.filter((y) => y.name !== n))} aria-label={`Don't send ${n}`}>{n} ×</button>)}
          <span className="oc-tile-note">Sent with your answers when you save.</span>
        </div>
      )}
      <div className="oc-tile-row">
        <IkButton disabled={off} onClick={save}>{busy ? "Saving…" : "Save and continue"}</IkButton>
        <span className="oc-tile-note">You can change any of this later in your profile.</span>
      </div>
      {error && <p className="oc-error" role="alert">{error}</p>}
    </div>
  );
}

Object.assign(window, { OcIntakeTile, ikBuild, IK_AGENT_PROMPT });
