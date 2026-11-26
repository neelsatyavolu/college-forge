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
  gpaTrend: [["up", "Going up"], ["steady", "Steady"], ["down", "Going down"], ["", "Not sure"]],
  incomeBracket: [["lt30", "Under $30k"], ["30-48", "$30–48k"], ["48-75", "$48–75k"], ["75-110", "$75–110k"], ["gt110", "Over $110k"], ["unsure", "Not sure"]],
  budget: [["lt15", "Under $15k"], ["15-30", "$15–30k"], ["30-50", "$30–50k"], ["50plus", "$50k+"], ["unsure", "Not sure"]],
  needAid: [["yes", "Yes"], ["no", "No"], ["", "Not sure"]],
  firstGen: [["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]],
  ambition: [["ambitious", "More reaches"], ["balanced", "Balanced"], ["conservative", "More likely schools"], ["", "Not sure"]],
  ed: [["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]],
};

/** Suggested counts by mix, for students who don't know how many schools to apply to. */
const IK_RECOMMENDED = { ambitious: [9, 3], balanced: [8, 3], conservative: [6, 4], "": [8, 3] };

function IkChips({ name, value, onChange, disabled }) {
  return (
    <div className="ik-chips" role="radiogroup" aria-label={name}>
      {IK_CHOICES[name].map(([v, label]) => (
        <button key={v + label} type="button" className="ik-chip" aria-pressed={value === v} disabled={disabled} onClick={() => onChange(value === v ? undefined : v)}>{label}</button>
      ))}
    </div>
  );
}

function IkField({ label, hint, children, wide }) {
  return (
    <label className={"ik-field" + (wide ? " ik-field--wide" : "")}>
      <span className="ik-label">{label}{hint && <em>{hint}</em>}</span>
      {children}
    </label>
  );
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
    sat: ikStr(t.sat || a.sat), act: ikStr(t.act), testOptional: /optional|not submit/i.test(t.satNote || a.satNote || ""),
    intended: ikStr(p.intended),
    incomeBracket: lp.incomeBracket, budget: lp.budget, needAid: lp.needAid === true ? "yes" : lp.needAid === false ? "no" : undefined, firstGen: lp.firstGen,
    ambition: lp.ambitionChosen ? lp.ambition : undefined,
    suppCount: lp.suppCount === undefined ? "" : String(lp.suppCount), noSuppCount: lp.noSuppCount === undefined ? "" : String(lp.noSuppCount),
    recommendCounts: false, ed: lp.ed,
  };
}

/** The patch the form saves, and a readable summary of what was given and what was left blank. */
function ikBuild(f) {
  const num = (v, max) => (/^\d+(\.\d+)?$/.test(String(v).trim()) && Number(v) <= max ? String(v).trim() : "");
  const applicant = {
    ...(f.name.trim() ? { name: f.name.trim() } : {}),
    ...(num(f.gpaUnweighted, 4) ? { gpaUnweighted: num(f.gpaUnweighted, 4) } : {}),
    ...(num(f.gpaWeighted, 6) ? { gpaWeighted: num(f.gpaWeighted, 6) } : {}),
    ...(num(f.gpaRecent, 4) ? { gpaRecent: num(f.gpaRecent, 4) } : {}),
    ...(f.gpaTrend ? { gpaTrend: f.gpaTrend } : {}),
  };
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
  };
  const label = (k, v) => (IK_CHOICES[k].find(([x]) => x === v) || [, v])[1];
  const said = [
    applicant.name && `Name: ${applicant.name}`, profile.hs && `High school: ${profile.hs}`, profile.gradYear && `Class of ${profile.gradYear}`,
    f.residency && `State: ${f.residency === "INTL" ? "outside the US" : f.residency}`, listPrefs.citizenship && `Citizenship: ${label("citizenship", listPrefs.citizenship)}`,
    applicant.gpaUnweighted && `Unweighted GPA ${applicant.gpaUnweighted}`, applicant.gpaWeighted && `weighted ${applicant.gpaWeighted}`,
    applicant.gpaRecent && `10th–11th GPA ${applicant.gpaRecent}`, applicant.gpaTrend && `Grades ${label("gpaTrend", applicant.gpaTrend).toLowerCase()}`,
    f.testOptional ? "Applying test-optional" : [testing.sat && `SAT ${testing.sat}`, testing.act && `ACT ${testing.act}`].filter(Boolean).join(", "),
    profile.intended && `Interested in: ${profile.intended}`,
    listPrefs.incomeBracket && `Family income: ${label("incomeBracket", listPrefs.incomeBracket)}`, listPrefs.budget && `Budget: ${label("budget", listPrefs.budget)} a year`,
    listPrefs.needAid !== undefined && `Need-based aid: ${listPrefs.needAid ? "yes" : "no"}`, listPrefs.firstGen && `First-gen: ${label("firstGen", listPrefs.firstGen)}`,
    listPrefs.ambition && `Mix: ${label("ambition", listPrefs.ambition)}`,
    supp !== undefined && `${supp} schools with supplements and ${quick} without${f.recommendCounts ? " (Forge's suggestion; I wasn't sure)" : ""}`,
    listPrefs.ed && `Early Decision: ${listPrefs.ed}`,
  ].filter(Boolean);
  const blanks = [
    !applicant.gpaUnweighted && !applicant.gpaWeighted && "GPA", !f.testOptional && !testing.sat && !testing.act && "test scores",
    !profile.intended && "intended major", !listPrefs.incomeBracket && "family income", !listPrefs.budget && "budget",
    listPrefs.needAid === undefined && "need-based aid", !listPrefs.ambition && "list mix", supp === undefined && "how many schools", !listPrefs.ed && "Early Decision",
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

function OcIntakeTile({ data, disabled, onAnswer }) {
  const [f, setF] = React.useState(() => ikInitial(data));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v && v.target ? (v.target.type === "checkbox" ? v.target.checked : v.target.value) : v }));
  const off = disabled || busy;

  const save = async () => {
    const { patch, said, blanks } = ikBuild(f);
    if (!said.length) { setError("Fill in anything you know, or use one of the other ways above."); return; }
    setBusy(true); setError("");
    try {
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => Object.keys(v).length));
      if (Object.keys(clean).length) await window.cfApi.patch({ ...clean, ...(Number.isInteger(data && data.revision) ? { baseRevision: data.revision } : {}) });
      onAnswer([`I filled in the quick start:`, ...said.map((s) => `- ${s}`), ...(blanks.length ? [`Not sure / left blank: ${blanks.join(", ")}.`] : [])].join("\n"));
    } catch (e) {
      setError(e.status === 409 ? "Your profile changed in another tab. Reload and try again." : e.message || "That didn't save. Try again.");
    }
    setBusy(false);
  };

  return (
    <div className="ik">
      <IkAgentPaste disabled={off} onAnswer={onAnswer} />
      <window.OcUploadTile compact disabled={off} onAnswer={(msg) => onAnswer(`${msg} It has my grades, activities or other details; please read it and fill in what you can.`)} />
      <p className="ik-or">Or fill in what you know. Skip anything you're not sure about.</p>

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
          <IkField label="Citizenship" wide><IkChips name="citizenship" value={f.citizenship} disabled={off} onChange={set("citizenship")} /></IkField>
        </div>
      </fieldset>

      <fieldset className="ik-group"><legend>Grades and tests</legend>
        <div className="ik-grid">
          <IkField label="Unweighted GPA" hint="out of 4.0"><input className="oc-input" inputMode="decimal" value={f.gpaUnweighted} disabled={off} onChange={set("gpaUnweighted")} maxLength={4} /></IkField>
          <IkField label="Weighted GPA"><input className="oc-input" inputMode="decimal" value={f.gpaWeighted} disabled={off} onChange={set("gpaWeighted")} maxLength={4} /></IkField>
          <IkField label="10th–11th GPA" hint="unweighted, if you know it"><input className="oc-input" inputMode="decimal" value={f.gpaRecent} disabled={off} onChange={set("gpaRecent")} maxLength={4} /></IkField>
          <IkField label="SAT"><input className="oc-input" inputMode="numeric" value={f.sat} disabled={off || f.testOptional} onChange={set("sat")} maxLength={4} /></IkField>
          <IkField label="ACT"><input className="oc-input" inputMode="numeric" value={f.act} disabled={off || f.testOptional} onChange={set("act")} maxLength={2} /></IkField>
          <label className="ik-check"><input type="checkbox" checked={f.testOptional} disabled={off} onChange={set("testOptional")} /> Not sending scores</label>
          <IkField label="My grades are" wide><IkChips name="gpaTrend" value={f.gpaTrend} disabled={off} onChange={set("gpaTrend")} /></IkField>
        </div>
      </fieldset>

      <fieldset className="ik-group"><legend>What you want to study</legend>
        <IkField label="Majors you're considering" hint="or Undecided" wide><input className="oc-input" placeholder="Economics, maybe computer science" value={f.intended} disabled={off} onChange={set("intended")} maxLength={200} /></IkField>
      </fieldset>

      <fieldset className="ik-group"><legend>Money</legend>
        <p className="ik-note">Colleges price by family income, so this is how Forge estimates what each school would really cost you. It stays in your workspace.</p>
        <div className="ik-grid">
          <IkField label="Family income per year" wide><IkChips name="incomeBracket" value={f.incomeBracket} disabled={off} onChange={set("incomeBracket")} /></IkField>
          <IkField label="What your family can pay per year" wide><IkChips name="budget" value={f.budget} disabled={off} onChange={set("budget")} /></IkField>
          <IkField label="Applying for need-based aid?"><IkChips name="needAid" value={f.needAid} disabled={off} onChange={set("needAid")} /></IkField>
          <IkField label="First in your family to go to college?"><IkChips name="firstGen" value={f.firstGen} disabled={off} onChange={set("firstGen")} /></IkField>
        </div>
      </fieldset>

      <fieldset className="ik-group"><legend>Your list</legend>
        <div className="ik-grid">
          <IkField label="Mix of schools" wide><IkChips name="ambition" value={f.ambition} disabled={off} onChange={set("ambition")} /></IkField>
          <IkField label="Schools with supplement essays" hint="all UCs = 1"><input className="oc-input" inputMode="numeric" placeholder="6–10" value={f.recommendCounts ? "" : f.suppCount} disabled={off || f.recommendCounts} onChange={set("suppCount")} maxLength={2} /></IkField>
          <IkField label="Quick apps, no supplements"><input className="oc-input" inputMode="numeric" placeholder="2–5" value={f.recommendCounts ? "" : f.noSuppCount} disabled={off || f.recommendCounts} onChange={set("noSuppCount")} maxLength={2} /></IkField>
          <label className="ik-check"><input type="checkbox" checked={f.recommendCounts} disabled={off} onChange={set("recommendCounts")} /> Not sure: recommend for me</label>
          <IkField label="Early Decision (binding)?" wide><IkChips name="ed" value={f.ed} disabled={off} onChange={set("ed")} /></IkField>
        </div>
      </fieldset>

      <div className="oc-tile-row">
        <IkButton disabled={off} onClick={save}>{busy ? "Saving…" : "Save and continue"}</IkButton>
        <span className="oc-tile-note">You can change any of this later in your profile.</span>
      </div>
      {error && <p className="oc-error" role="alert">{error}</p>}
    </div>
  );
}

Object.assign(window, { OcIntakeTile, ikBuild, IK_AGENT_PROMPT });
