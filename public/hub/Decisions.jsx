const { Button } = window.CollegeForgeDesignSystem_e95e63;

// Only a fallback for an older server: the server's decision.result (lib/decision-letter.ts) is the real one.
// Negative outcomes first: "Not admitted" contains "admitted".
const OUTCOME_GUESS = [
  [/\b(not admitted|not accepted|not offered|deny|denied|rejected|not csu eligible|unable to offer)\b/i, "denied"],
  [/\bwait ?list(ed)?\b/i, "waitlisted"],
  [/\bdefer(red)?\b/i, "deferred"],
  [/\b(admit|admitted|accept|accepted|congratulations|offered)\b/i, "admitted"],
];
const guessOutcome = (text) => (OUTCOME_GUESS.find(([re]) => re.test(text || "")) || [])[1] || "";
const resultOf = (app) => (app.decision.result !== undefined ? app.decision.result : guessOutcome(app.decision.portalText));
const celebrate = () => { if (window.cfConfetti) window.cfConfetti(); };

const RESULT_NOTE = {
  deferred: "Your application moves to Regular Decision and gets read again with that pool. Send any new grades or news through the portal.",
  waitlisted: "You're on the waitlist. Most schools ask you to opt in through the portal to stay on it.",
};

function RecordButtons({ app, suggested, act, busy }) {
  const { statusMeta } = window.cfApp;
  const options = ["admitted", "denied", "waitlisted", "deferred"];
  const settled = app.status === suggested;
  return (
    <div className="cf-row-actions">
      <span className="cf-help">{settled ? "Not right? Change it:" : "Record it:"}</span>
      {suggested && !settled ? <Button size="sm" disabled={busy} onClick={() => act(app, suggested)}>{statusMeta(suggested).label}</Button> : null}
      {options.filter((o) => o !== suggested && o !== app.status).map((o) => <Button key={o} size="sm" variant="secondary" disabled={busy} onClick={() => act(app, o)}>{statusMeta(o).label}</Button>)}
    </div>
  );
}

function KnownDecision({ app, fresh, busy, record, onWorkspaceChange }) {
  const { SchoolMark, statusMeta } = window.cfApp;
  const { DecisionLetter, LetterAwards } = window;
  const words = app.decision.portalText;
  const result = resultOf(app);
  const meta = statusMeta(app.status);
  const revealed = app.decision.state === "revealed";
  const recorded = app.stage === "admitted" || app.stage === "denied" || app.status === "deferred" || app.status === "waitlisted";
  const showDetail = fresh || (revealed && (!recorded || app.letter));
  const heading = words || (result ? statusMeta(result).label : "");
  return (
    <li className="cf-decision">
      <SchoolMark name={app.name} logo={app.logo} />
      <div>
        <h3 className="cf-decision__school">{app.name}</h3>
        {revealed && !heading && !app.letter && !fresh ? <div className="cf-decision__note">The portal posted a decision. Open the portal to read it.</div> : null}
      </div>
      {recorded ? <span className="cf-outcome" style={{ "--tone": meta.tone }}>{meta.label}</span> : <span />}
      {showDetail ? (
        <div className="cf-decision__reveal">
          {fresh ? <p className={"cf-decision__words" + (result === "admitted" ? " is-admit" : "")}>{heading || "Your decision is in the portal."}</p> : null}
          {revealed && RESULT_NOTE[result] ? <p className="cf-decision__result">{RESULT_NOTE[result]}</p> : null}
          {revealed ? <LetterAwards app={app} letter={app.letter} onAdded={onWorkspaceChange} /> : null}
          {revealed && app.letter ? <DecisionLetter app={app} school={app.name} /> : null}
          {revealed && !app.letter && app.portalUrl && !app.portalFromEmail ? <a href={app.portalUrl} target="_blank" rel="noopener noreferrer" className="cf-link-btn">Open {app.portalName || "the portal"} ↗</a> : null}
          {fresh || !recorded ? <RecordButtons app={app} suggested={result} act={record} busy={busy} /> : null}
        </div>
      ) : null}
      {(app.letterHistory || []).length ? (
        <div className="cf-decision__reveal">
          {app.letterHistory.map((l) => (
            <div key={l.id} className="cf-decision__history">
              <span className="cf-help">Earlier letter{l.result ? `: ${statusMeta(l.result).label}` : ""}</span>
              <DecisionLetter app={app} letterId={l.id} school={app.name} />
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function Decisions({ tracker, onTrackerChange, onWorkspaceChange }) {
  const { SchoolMark, fmtDate } = window.cfApp;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [justRevealed, setJustRevealed] = React.useState(null);
  const apps = tracker.apps;
  const hidden = apps.filter((a) => a.decision.state === "hidden");
  const known = apps.filter((a) => a.decision.state === "revealed" || a.decision.state === "recorded");
  const waiting = apps.filter((a) => a.decision.state === "none" && a.stage === "waiting");

  const run = async (body) => {
    setBusy(true);
    setError("");
    try {
      const j = await window.cfApi.applications(body);
      onTrackerChange(j.data);
      return j;
    } catch (e) { setError(e.message); return null; } finally { setBusy(false); }
  };
  const reveal = async (app) => {
    const j = await run({ action: "reveal", id: app.id });
    if (!j) return;
    setJustRevealed(app.id);
    if (j.app && resultOf(j.app) === "admitted") celebrate();
  };
  const record = async (app, status) => {
    if ((await run({ action: "update", id: app.id, edit: { status } })) && (status === "admitted" || status === "committed")) celebrate();
  };

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Decisions</h1>
          <p className="cf-page-lede">When a portal posts a decision, Forge keeps it covered here until you choose to open it.</p>
        </div>
      </header>
      {error ? <div role="alert" className="cf-notice">{error}</div> : null}
      {apps.filter((a) => a.stage === "admitted").length >= 2 ? <p className="cf-help" style={{ marginBottom: 20 }}><a href="#board">Compare your offers on the Decision board →</a></p> : null}

      {hidden.length ? (
        <section className="cf-apps-group" aria-labelledby="dec-new">
          <div className="cf-apps-group__head"><h2 id="dec-new">Ready when you are</h2><span>{hidden.length}</span></div>
          <ul className="cf-apps-list">
            {hidden.map((a) => (
              <li key={a.id} className="cf-decision">
                <SchoolMark name={a.name} logo={a.logo} />
                <div><h3 className="cf-decision__school">{a.name}</h3><div className="cf-decision__note">A decision is posted in the portal.</div></div>
                <div className="cf-row-actions"><Button size="sm" disabled={busy} onClick={() => reveal(a)}>Open decision</Button></div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {known.length ? (
        <section className="cf-apps-group" aria-labelledby="dec-known">
          <div className="cf-apps-group__head"><h2 id="dec-known">Your decisions</h2><span>{known.length}</span></div>
          <ul className="cf-apps-list">
            {known.map((a) => <KnownDecision key={a.id} app={a} fresh={justRevealed === a.id} busy={busy} record={record} onWorkspaceChange={onWorkspaceChange} />)}
          </ul>
        </section>
      ) : null}

      {waiting.length ? (
        <section className="cf-apps-group" aria-labelledby="dec-waiting">
          <div className="cf-apps-group__head"><h2 id="dec-waiting">Still waiting</h2><span>{waiting.length}</span></div>
          <ul className="cf-apps-list">
            {waiting.map((a) => (
              <li key={a.id} className="cf-decision">
                <SchoolMark name={a.name} logo={a.logo} />
                <div>
                  <h3 className="cf-decision__school">{a.name}</h3>
                  <div className="cf-decision__note">{a.decisionDate ? `Expected ${fmtDate(a.decisionDate.date)}${a.decisionDate.estimated ? ", going by last year" : ""}` : "No decision date yet"}</div>
                </div>
                <span />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!hidden.length && !known.length && !waiting.length ? (
        <div className="cf-empty">No decisions yet. Once you submit, schools you’re waiting on show here with their expected dates.</div>
      ) : null}
    </div>
  );
}

window.Decisions = Decisions;
