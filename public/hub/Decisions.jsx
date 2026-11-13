const { Button } = window.CollegeForgeDesignSystem_e95e63;

const OUTCOME_GUESS = [
  [/\b(admit|admitted|accept|accepted|congratulations|offered)\b/i, "admitted"],
  [/\b(deny|denied|not admitted|rejected|not csu eligible)\b/i, "denied"],
  [/\bwait ?list(ed)?\b/i, "waitlisted"],
  [/\bdefer(red)?\b/i, "deferred"],
];
const guessOutcome = (text) => (OUTCOME_GUESS.find(([re]) => re.test(text || "")) || [])[1] || "";

function RecordButtons({ app, suggested, act, busy }) {
  const { statusMeta } = window.cfApp;
  const options = ["admitted", "denied", "waitlisted", "deferred"];
  if (app.status === suggested) return null;
  return (
    <div className="cf-row-actions">
      <span className="cf-help">Record it:</span>
      {suggested ? <Button size="sm" disabled={busy} onClick={() => act(app, suggested)}>{statusMeta(suggested).label}</Button> : null}
      {options.filter((o) => o !== suggested).map((o) => <Button key={o} size="sm" variant="secondary" disabled={busy} onClick={() => act(app, o)}>{statusMeta(o).label}</Button>)}
    </div>
  );
}

function Decisions({ tracker, onTrackerChange }) {
  const { SchoolMark, statusMeta, fmtDate } = window.cfApp;
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
  const reveal = async (app) => { if (await run({ action: "reveal", id: app.id })) setJustRevealed(app.id); };
  const record = (app, status) => run({ action: "update", id: app.id, edit: { status } });

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Decisions</h1>
          <p className="cf-page-lede">When a portal posts a decision, Forge keeps it covered here until you choose to open it.</p>
        </div>
      </header>
      {error ? <div role="alert" className="cf-notice">{error}</div> : null}

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
            {known.map((a) => {
              const fresh = justRevealed === a.id;
              const words = a.decision.portalText;
              const suggested = guessOutcome(words);
              const meta = statusMeta(a.status);
              const recorded = a.stage === "admitted" || a.stage === "denied" || a.status === "deferred" || a.status === "waitlisted";
              return (
                <li key={a.id} className="cf-decision">
                  <SchoolMark name={a.name} logo={a.logo} />
                  <div>
                    <h3 className="cf-decision__school">{a.name}</h3>
                    {a.decision.state === "revealed" && !words && !fresh ? <div className="cf-decision__note">The portal posted a decision. Open the portal to read it.</div> : null}
                  </div>
                  {recorded ? <span className="cf-outcome" style={{ "--tone": meta.tone }}>{meta.label}</span> : <span />}
                  {fresh || (a.decision.state === "revealed" && !recorded) ? (
                    <div className="cf-decision__reveal">
                      {fresh ? <p className={"cf-decision__words" + (suggested === "admitted" ? " is-admit" : "")}>{words || "Your decision is in the portal."}</p> : null}
                      {!words ? <a href={a.portalUrl} target="_blank" rel="noopener noreferrer" className="cf-link-btn">Open {a.portalName || "the portal"} ↗</a> : null}
                      <RecordButtons app={a} suggested={suggested} act={record} busy={busy} />
                    </div>
                  ) : null}
                </li>
              );
            })}
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
