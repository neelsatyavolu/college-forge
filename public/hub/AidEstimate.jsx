const { Badge, Button } = window.CollegeForgeDesignSystem_e95e63;

/**
 * Recs & aid: the aid estimate (SAI, Pell, per-school net price vs budget) from lib/aid-estimate.ts, the optional
 * aid details that sharpen it (lib/aid-profile.ts), and the FAFSA / CSS Profile steps (lib/aid-checklist.ts).
 * Everything comes from GET /api/aid; edits save through PATCH /api/workspace { aidProfile }.
 */

const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US");
const range = (r, fmt = money) => (!r ? "—" : r.low === r.high ? fmt(r.low) : `${fmt(r.low)} to ${fmt(r.high)}`);
const index = (n) => n.toLocaleString("en-US");

const CHOICES = {
  parentStatus: [["married", "Married"], ["unmarried_together", "Unmarried, living together"], ["divorced_separated", "Divorced or separated"], ["single", "Single"], ["widowed", "Widowed"]],
  parentsFiledTaxes: [["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]],
  parentAssets: [["lt10", "Under $10,000"], ["10-50", "$10,000 to $50,000"], ["50-100", "$50,000 to $100,000"], ["100-250", "$100,000 to $250,000"], ["250-500", "$250,000 to $500,000"], ["gt500", "Over $500,000"]],
  homeEquity: [["none", "None / we rent"], ["lt100", "Under $100,000"], ["100-250", "$100,000 to $250,000"], ["250-500", "$250,000 to $500,000"], ["gt500", "Over $500,000"]],
  business: [["no", "No"], ["yes", "Yes"], ["unsure", "Not sure"]],
  studentIncome: [["lt5", "Under $5,000"], ["5-12", "$5,000 to $12,000"], ["12-20", "$12,000 to $20,000"], ["gt20", "Over $20,000"]],
  studentSavings: [["lt1", "Under $1,000"], ["1-5", "$1,000 to $5,000"], ["5-15", "$5,000 to $15,000"], ["gt15", "Over $15,000"]],
  benefits: [["no", "No"], ["yes", "Yes"], ["unsure", "Not sure"]],
  independent: [["no", "No"], ["yes", "Yes"], ["unsure", "Not sure"]],
};
const FIELDS = [
  ["householdSize", "People in your household", "number", 1, 15],
  ["parentStatus", "Parents' marital status"],
  ["parentsFiledTaxes", "Parents filed a 2025 tax return?"],
  ["parentAgi", "Parents' 2025 income (AGI), roughly", "number", 0, 10000000],
  ["parentAssets", "Parents' savings and investments"],
  ["benefits", "SNAP, SSI, WIC, Medicaid or free lunch?"],
  ["studentIncome", "Your 2025 earnings"],
  ["studentSavings", "Your savings"],
  ["inCollege", "Family members in college in 2027-28", "number", 1, 8],
  ["homeEquity", "Home equity (CSS Profile only)"],
  ["business", "Family business or farm?"],
  ["independent", "Independent student?"],
];
const BASIS = { full_need: "Meets full need", school_average: "Average at your income", nonresident: "Out-of-state public", none: "No data yet" };
const FITS = { yes: ["teal", "Fits budget"], maybe: ["cream", "Close to budget"], no: ["coral", "Over budget"] };

const label = { fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)" };
const field = { padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)", fontSize: 13, width: "100%", boxSizing: "border-box" };

function Stat({ title, value, detail }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={label}>{title}</div>
      <div className="cf-nums" style={{ fontSize: 22, color: "var(--ink)", margin: "4px 0 2px" }}>{value}</div>
      {detail ? <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{detail}</div> : null}
    </div>
  );
}

function AidDetailsForm({ details, why, onSave, busy }) {
  const initial = () => Object.fromEntries(FIELDS.map(([k]) => [k, details[k] === undefined ? "" : String(details[k])]));
  const [draft, setDraft] = React.useState(initial);
  React.useEffect(() => setDraft(initial()), [JSON.stringify(details)]);
  const dirty = FIELDS.some(([k]) => draft[k] !== (details[k] === undefined ? "" : String(details[k])));
  const submit = (e) => { e.preventDefault(); onSave(Object.fromEntries(FIELDS.map(([k]) => [k, draft[k] === "" ? null : draft[k]]))); };
  return (
    <form onSubmit={submit}>
      <p className="cf-help" style={{ marginBottom: 12 }}>Every question is optional; skip any you don't know. These stay in your workspace: parents, counselors and share links don't see them. Never enter a Social Security number or FSA ID here.</p>
      <div className="cf-aid-fields">
        {FIELDS.map(([key, text, kind, min, max]) => (
          <label key={key} style={{ display: "block", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13, color: "var(--ink)", marginBottom: 4 }}>{text}</span>
            {kind === "number" ? (
              <input type="number" inputMode="numeric" min={min} max={max} step={key === "parentAgi" ? 1000 : 1} value={draft[key]} disabled={busy}
                placeholder={key === "parentAgi" ? "e.g. 85000" : "Skip"} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} style={field} />
            ) : (
              <select value={draft[key]} disabled={busy} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} style={field}>
                <option value="">Skip</option>
                {CHOICES[key].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
            <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>{why[key]}</span>
          </label>
        ))}
      </div>
      <div style={{ marginTop: 14 }}><Button size="sm" type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save aid details"}</Button></div>
    </form>
  );
}

function SchoolRows({ schools, cap }) {
  if (!schools.length) return <p className="cf-help">Add schools to <a href="#shortlist">Your shortlist</a> to see each one's estimated price.</p>;
  return (
    <ul className="cf-aid-schools">
      {schools.map((s) => {
        const fit = s.fitsBudget ? FITS[s.fitsBudget] : null;
        return (
          <li key={s.slug}>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: 14, color: "var(--ink)" }}>{s.name}</strong>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginTop: 2 }}>{BASIS[s.basis]}. {s.note}</div>
            </div>
            <div className="cf-aid-schools__nums">
              <div><span style={label}>Cost</span><span className="cf-nums">{s.coa === null ? "—" : money(s.coa)}</span></div>
              <div><span style={label}>You'd pay</span><span className="cf-nums">{s.netPrice ? range(s.netPrice) : "—"}</span></div>
              {cap !== null && fit ? <Badge variant={fit[0]}>{fit[1]}</Badge> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AidEstimatePanel({ estimate, details, why, onSave, busy }) {
  const [editing, setEditing] = React.useState(false);
  const [showAssumptions, setShowAssumptions] = React.useState(false);
  const given = Object.keys(details).length;
  const { sai, pell, status, budgetCap } = estimate;
  const pellText = !pell ? "—" : pell.eligible === "no" ? "Not likely" : pell.eligible === "maybe" ? `Maybe, up to ${money(pell.amount.high)}` : `Likely, ${range(pell.amount)}`;
  return (
    <div>
      {status === "ok" ? (
        <div className="cf-aid-stats">
          <Stat title={`Student Aid Index (${estimate.awardYear})`} value={range(sai, index)} detail="Roughly what the FAFSA expects your family to pay a year. 0 or below means the most federal aid." />
          <Stat title="Pell Grant" value={pellText} detail={pell && pell.eligible !== "no" ? "Federal grant per year, full-time. You don't pay it back." : "Pell goes to families with lower SAIs."} />
          <Stat title="Your budget" value={budgetCap === null ? "No cap set" : `Up to ${money(budgetCap)}`} detail="From your list preferences, per year." />
        </div>
      ) : (
        <p className="cf-notice" style={{ marginBottom: 12 }}>{estimate.assumptions[0]}</p>
      )}
      <SchoolRows schools={estimate.schools} cap={budgetCap} />
      <div className="cf-inline-actions" style={{ marginTop: 14 }}>
        <button type="button" className="cf-link-btn" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
          {editing ? "Hide aid details" : given ? `Edit your aid details (${given} of 12)` : "Add aid details for a better estimate"}
        </button>
        {status === "ok" ? <button type="button" className="cf-link-btn" aria-expanded={showAssumptions} onClick={() => setShowAssumptions((v) => !v)}>{showAssumptions ? "Hide assumptions" : "How this is estimated"}</button> : null}
      </div>
      {showAssumptions && status === "ok" ? (
        <div style={{ marginTop: 8 }}>
          <ul className="cf-help" style={{ paddingLeft: 18, margin: "0 0 8px" }}>{estimate.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          <p className="cf-help">An estimate from the official 2027-28 federal formula, not an offer. Schools' own aid and the CSS Profile can differ. <a href={estimate.source} target="_blank" rel="noopener noreferrer">The formula guide →</a></p>
        </div>
      ) : null}
      {editing ? <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}><AidDetailsForm details={details} why={why} onSave={onSave} busy={busy} /></div> : null}
    </div>
  );
}

function AidSteps({ steps }) {
  return (
    <ol className="cf-aid-steps">
      {steps.map((s, i) => (
        <li key={s.id}>
          <span className="cf-aid-steps__n cf-nums" aria-hidden="true">{i + 1}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <strong style={{ fontSize: 14, color: "var(--ink)" }}>{s.title}</strong>
              {s.done ? <Badge variant="teal">Done</Badge> : null}
            </div>
            <p className="cf-help" style={{ margin: "2px 0 6px" }}>{s.why}</p>
            <ul className="cf-help" style={{ paddingLeft: 18, margin: 0 }}>{s.items.map((t) => <li key={t}>{t}</li>)}</ul>
            {s.links.length ? (
              <div className="cf-inline-actions" style={{ marginTop: 6 }}>
                {s.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.label} →</a>)}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Loads /api/aid and renders the estimate and steps as two panels, using Track's Panel. */
function AidEstimate({ Panel, revision, onSave, busy, onAsk }) {
  const [aid, setAid] = React.useState(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let live = true;
    fetch("/api/aid", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => { const j = await res.json().catch(() => ({})); if (!res.ok || j.success === false) throw new Error((j && j.error) || "Couldn't load your aid estimate."); return j.data; })
      .then((d) => { if (live) { setAid(d); setError(""); } })
      .catch((e) => { if (live) setError(e.message || "Couldn't load your aid estimate."); });
    return () => { live = false; };
  }, [revision]);
  if (error && !aid) return <Panel title="Aid estimate"><p className="cf-notice" role="alert">{error}</p></Panel>;
  if (!aid || !aid.estimate) return <Panel title="Aid estimate"><p role="status" className="cf-help">Loading your aid estimate…</p></Panel>;
  const ask = onAsk ? <Button variant="secondary" size="sm" onClick={() => onAsk("Help me fill out the FAFSA and CSS Profile step by step, using my aid details and my schools.")}>Help me fill it out ✱</Button> : null;
  return (
    <React.Fragment>
      <Panel title="Aid estimate">
        <AidEstimatePanel estimate={aid.estimate} details={aid.details || {}} why={aid.why || {}} onSave={onSave} busy={busy} />
      </Panel>
      <Panel title="What you'll need: FAFSA and CSS Profile" action={ask}>
        <AidSteps steps={aid.checklist || []} />
      </Panel>
    </React.Fragment>
  );
}
window.AidEstimate = AidEstimate;
