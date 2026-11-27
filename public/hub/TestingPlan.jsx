// One school's testing plan: its SAT/ACT policy (from Forge's sourced research), Forge's suggestion, and the
// student's own choice: send or withhold, self-report or official, when the official report went out, AP self-report.

const TP_POLICY = { required: "Test-required", optional: "Test-optional", blind: "Test-blind", flexible: "Varies by program", unknown: "Policy not on file" };
const TP_TONE = { send: "var(--success)", your_call: "var(--accent-amber)", consider_withholding: "var(--coral)", dont_send: "var(--muted-soft)", no_score: "var(--muted-soft)", check_site: "var(--muted-soft)" };
const TP_DATE = /^\d{4}-\d{2}-\d{2}$/;

function policyLine(p) {
  const bits = [TP_POLICY[p.kind] || TP_POLICY.unknown];
  if (p.selfReport === true) bits.push("self-reported scores accepted");
  if (p.selfReport === false) bits.push("official scores only");
  if (p.superscore === true) bits.push("superscores");
  if (p.superscore === false) bits.push("no superscoring");
  return bits.join(" · ");
}

function TestingPlan({ app, act, busy }) {
  const tp = app.testingPlan;
  const [sent, setSent] = React.useState((tp && tp.choice.officialSent) || "");
  if (!tp) return null;
  const c = tp.choice;
  const r = tp.recommendation;
  const save = (testing, msg) => act({ action: "update", id: app.id, edit: { testing } }, msg);
  const sending = c.plan === "send";

  return (
    <div className="cf-testing">
      <h3 className="cf-subhead">Testing plan</h3>
      <p className="cf-help" style={{ marginBottom: 8 }}>
        {policyLine(tp.policy)}
        {tp.policy.sourceUrl ? <React.Fragment> · <a href={tp.policy.sourceUrl} target="_blank" rel="noopener noreferrer">Source ↗</a></React.Fragment> : null}
      </p>
      <p className="cf-testing__advice">
        <span className="cf-badge" style={{ "--tone": TP_TONE[r.advice] || "var(--muted-soft)" }}>{r.label}</span>
        <span>{r.reason}</span>
      </p>
      {tp.policy.text ? <p className="cf-help" style={{ marginBottom: 12 }}>“{tp.policy.text}”</p> : null}
      <div className="cf-fields" style={{ alignItems: "end" }}>
        <label className="cf-field">Your plan
          <select value={c.plan} disabled={busy} onChange={(e) => save({ plan: e.target.value }, "Testing plan saved.")}>
            <option value="undecided">Not decided</option>
            <option value="send">Send scores</option>
            <option value="withhold">Apply without scores</option>
          </select>
        </label>
        {sending ? (
          <label className="cf-field">How
            <select value={c.method || ""} disabled={busy} onChange={(e) => save({ method: e.target.value }, "Testing plan saved.")}>
              <option value="">Not chosen</option>
              <option value="self_report" disabled={tp.policy.selfReport === false}>Self-report{tp.policy.selfReport === false ? " (not accepted here)" : ""}</option>
              <option value="official">Official report from College Board/ACT</option>
            </select>
          </label>
        ) : null}
        {sending && c.method === "official" ? (
          <label className="cf-field">Official scores sent on
            <input type="date" value={sent} disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                setSent(v);
                if (v === "" || TP_DATE.test(v)) save({ officialSent: v }, v ? "Score send recorded." : "Score send cleared.").then((ok) => { if (!ok) setSent(c.officialSent || ""); });
              }} />
          </label>
        ) : null}
      </div>
      {tp.hasAps ? (
        <label className="cf-check" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <input type="checkbox" checked={!!c.apSelfReported} disabled={busy} onChange={(e) => save({ apSelfReported: e.target.checked }, e.target.checked ? "AP scores marked self-reported." : "AP scores unmarked.")} />
          <span>AP scores self-reported on this application</span>
        </label>
      ) : null}
    </div>
  );
}

window.TestingPlan = TestingPlan;
