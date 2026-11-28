const { Button } = window.CollegeForgeDesignSystem_e95e63;

/** What the portal last said, in one line. Decisions never show here, only that one is posted. */
/** The portal's own status line, or, when it shows none, what its checklist says. */
function portalSummary(app) {
  const p = app.portal;
  if (app.decision.state === "hidden") return { quoted: false, text: "Decision posted" };
  if (p.statusText) return { quoted: true, text: p.statusText };
  const required = (p.checklist || []).filter((c) => !c.optional);
  const missing = app.missing.length;
  if (missing) return { quoted: false, text: `${missing} item${missing === 1 ? "" : "s"} missing` };
  if (required.length) return { quoted: false, text: `All ${required.length} item${required.length === 1 ? "" : "s"} received` };
  return { quoted: false, text: "No status shown in the portal" };
}

function PortalLine({ app, odds }) {
  const { ago } = window.cfApp;
  const p = app.portal;
  const hidden = app.decision.state === "hidden";
  if (!p) {
    if (hidden) return <div className="cf-app-row__portal"><a href="#decisions" className="is-decision">A decision is posted. Open it on Decisions →</a></div>;
    const chance = odds ? <span style={{ color: "var(--muted)" }} title={`Likely range ${odds.low}–${odds.high}%`}><b style={{ fontWeight: 500, color: "var(--ink)" }}>{odds.percent}%</b> chance</span> : null;
    if (!app.login) return chance ? <div className="cf-app-row__portal">{chance}</div> : null;
    return <div className="cf-app-row__portal"><span className="is-error">Login saved. The next check fills this in.</span>{chance ? <> · {chance}</> : null}</div>;
  }
  if (!p.ok) return <div className="cf-app-row__portal"><span className="is-error">{p.error} · tried {ago(p.checkedAt)}</span></div>;
  const failed = app.lastFailure ? <div className="is-error">Latest check didn’t finish: {app.lastFailure.error} ({ago(app.lastFailure.at)}). Showing the last good check.</div> : null;
  // An unopened decision replaces the portal's own words (they could give it away), but missing items and failures still show.
  return (
    <div className="cf-app-row__portal">
      {hidden ? <a href="#decisions" className="is-decision">A decision is posted. Open it on Decisions →</a> : (
        <React.Fragment>
          <span>{p.statusText ? <React.Fragment>Portal says <b style={{ fontWeight: 500, color: "var(--ink)" }}>“{p.statusText}”</b></React.Fragment> : portalSummary(app).text}</span>
          <span style={{ color: "var(--muted)" }}> · {ago(p.checkedAt)}</span>
          {odds ? <span style={{ color: "var(--muted)" }} title={`Likely range ${odds.low}–${odds.high}%. From Estimate my chances.`}> · <b style={{ fontWeight: 500, color: "var(--ink)" }}>{odds.percent}%</b> chance</span> : null}
        </React.Fragment>
      )}
      {failed}
      {app.missing.length ? (
        <div className="cf-app-row__missing" aria-label="Still missing">
          {app.missing.map((m) => <span key={m}>Missing: {m}</span>)}
        </div>
      ) : null}
    </div>
  );
}

function AppDetails({ app, act, busy, checking, onCheck, master, data, onWorkspaceChange }) {
  const { APP_ROUNDS, fmtDate } = window.cfApp;
  const initial = { round: app.roundFromPortal ? "" : app.round || "", deadline: app.deadline || "", decisionDate: app.decisionDate && !app.decisionDate.estimated ? app.decisionDate.date : "", submittedAt: app.submittedAt || "", notes: app.notes || "", portalUrl: app.portalUrl || "" };
  const [form, setForm] = React.useState(initial);
  const [fu, setFu] = React.useState({ text: "", due: "" });
  const [login, setLogin] = React.useState({ username: (app.login && app.login.username) || "", password: "" });
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  // Only changed fields are sent: resending an unchanged portal link must not count as the student checking it.
  const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== initial[k]));
  const dirty = Object.keys(changed).length > 0;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const id = app.id;

  return (
    <div className="cf-app-details">
      <form className="cf-fields" onSubmit={(e) => { e.preventDefault(); act({ action: "update", id, edit: changed }, "Saved."); }}>
        <label className="cf-field">Round
          <select value={form.round} onChange={set("round")}>
            {APP_ROUNDS.map((r) => <option key={r.id} value={r.id}>{r.id === "" && app.roundFromPortal ? `From portal (${app.round})` : r.label}</option>)}
          </select>
        </label>
        <label className="cf-field">Deadline
          <input type="date" value={form.deadline} onChange={set("deadline")} />
        </label>
        <label className="cf-field">Submitted
          <input type="date" value={form.submittedAt} onChange={set("submittedAt")} />
        </label>
        <label className="cf-field">Decision date
          <input type="date" value={form.decisionDate} onChange={set("decisionDate")} />
          {app.decisionDate && app.decisionDate.estimated && !form.decisionDate ? <small>Last year: {fmtDate(app.decisionDate.date)}</small> : null}
        </label>
        <label className="cf-field" style={{ gridColumn: "1 / -1" }}>Portal link
          <input type="url" value={form.portalUrl} onChange={set("portalUrl")} placeholder="https://" />
          {app.portalFromEmail ? <small>This link came from a forwarded email. Check it goes to the school, then edit and save it before opening it or saving a login.</small> : null}
        </label>
        {app.hasAidItems || app.ignoreAid ? (
          <label className="cf-check" style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={app.ignoreAid} disabled={busy} onChange={(e) => act({ action: "update", id, edit: { ignoreAid: e.target.checked } }, e.target.checked ? "Financial aid items hidden for this school." : "Financial aid items count again.")} />
            <span>Not applying for aid here: ignore FAFSA, CSS Profile and tax forms</span>
          </label>
        ) : null}
        {data && app.slug && window.EssaySchoolToggle ? (() => {
          const college = (data.colleges || []).find((c) => c.slug === app.slug);
          return college ? <window.EssaySchoolToggle data={data} school={college} onWorkspaceChange={onWorkspaceChange} className="cf-check" label="Writing supplements for this school (they show on Essays)" /> : null;
        })() : null}
        <label className="cf-field" style={{ gridColumn: "1 / -1" }}>Notes
          <textarea value={form.notes} onChange={set("notes")} maxLength={4000} />
        </label>
        <div className="cf-row-actions" style={{ gridColumn: "1 / -1" }}>
          <Button type="submit" size="sm" disabled={busy || !dirty}>Save changes</Button>
          {app.portalUrl && !app.portalFromEmail ? <a href={app.portalUrl} target="_blank" rel="noopener noreferrer" className="cf-link-btn" style={{ display: "inline-flex", alignItems: "center" }}>Open {app.portalName || "portal"} ↗</a> : null}
        </div>
      </form>

      {window.TestingPlan ? <window.TestingPlan key={`tp-${id}-${(app.testingPlan && app.testingPlan.choice.officialSent) || ""}`} app={app} act={act} busy={busy} /> : null}

      <div>
        <h3 className="cf-subhead">Follow-ups</h3>
        {app.followUps && app.followUps.length ? (
          <ul className="cf-followups" style={{ marginBottom: 10 }}>
            {app.followUps.map((f) => (
              <li key={f.id}><label>
                <input type="checkbox" disabled={busy} onChange={() => act({ action: "followup-set", id, followUpId: f.id, done: true }, "Follow-up done.")} />
                <span>{f.text}{f.due ? ` · ${fmtDate(f.due)}` : ""}</span>
              </label></li>
            ))}
          </ul>
        ) : <p className="cf-help" style={{ marginBottom: 10 }}>Nothing left to chase for this school. These show on your Progress tab.</p>}
        <form className="cf-fields" style={{ alignItems: "end" }} onSubmit={(e) => { e.preventDefault(); act({ action: "followup-add", id, text: fu.text, due: fu.due }, "Follow-up added.").then((ok) => ok && setFu({ text: "", due: "" })); }}>
          <label className="cf-field" style={{ gridColumn: "span 2" }}>Add a follow-up
            <input value={fu.text} onChange={(e) => setFu({ ...fu, text: e.target.value })} placeholder="Counselor sends the mid-year report" maxLength={300} />
          </label>
          <label className="cf-field">Due
            <input type="date" value={fu.due} onChange={(e) => setFu({ ...fu, due: e.target.value })} />
          </label>
          <div><Button type="submit" size="sm" variant="secondary" disabled={busy || !fu.text.trim()}>Add</Button></div>
        </form>
      </div>

      {window.InterestLog ? <window.InterestLog app={app} act={act} busy={busy} /> : null}

      <window.FinishSetup app={app} />

      <form onSubmit={(e) => { e.preventDefault(); act({ action: "login", id, username: login.username, password: login.password }, "Login saved. Forge will check this portal for you.").then((ok) => ok && setLogin({ ...login, password: "" })); }}>
        <h3 className="cf-subhead">Portal login</h3>
        <p className="cf-help" style={{ marginBottom: 10 }}>
          {app.login ? (app.login.source === "master" ? `Using your master login (${app.login.username}). Saving a login below replaces it for this school. ` : `Saved for ${app.login.username}. `) : ""}Forge signs in to check your status on your check schedule. Passwords are encrypted and never shown again, not even to assistants you connect.
        </p>
        <window.MasterToggle app={app} master={master} act={act} busy={busy} />
        <div className="cf-fields" style={{ alignItems: "end" }}>
          <label className="cf-field">Username or email
            <input value={login.username} onChange={(e) => setLogin({ ...login, username: e.target.value })} autoComplete="off" name={`portal-user-${id}`} />
          </label>
          <label className="cf-field">Password
            <input type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} autoComplete="new-password" name={`portal-pass-${id}`} placeholder={app.login ? "Saved. Type to replace" : ""} />
          </label>
          <div className="cf-row-actions">
            <Button type="submit" size="sm" variant="secondary" disabled={busy || !login.username || !login.password}>{app.login ? "Replace login" : "Save login"}</Button>
            {app.login ? <Button size="sm" variant="secondary" disabled={busy || checking} onClick={onCheck}>{checking ? "Checking…" : "Check now"}</Button> : null}
            {app.login ? <button type="button" className="cf-link-btn" disabled={busy} onClick={() => act({ action: "forget-login", id }, "Login removed.")}>Forget login</button> : null}
          </div>
        </div>
      </form>

      <div className="cf-row-actions">
        {!confirmRemove ? <button type="button" className="cf-link-btn cf-link-btn--danger" onClick={() => setConfirmRemove(true)}>Remove {app.name}</button> : (
          <React.Fragment>
            <span className="cf-help">{app.offList
              ? "Remove this school and its saved login?"
              : app.untouched
                ? "Remove this school? It also leaves your college list. Essay drafts are kept."
                : "Remove this application and its saved login? The school stays on your college list. Essay drafts are kept."}</span>
            <Button size="sm" disabled={busy} onClick={() => act({ action: "remove", id }, `${app.name} removed.`)}>Remove</Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmRemove(false)}>Keep it</Button>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

/** One school. Compact rows fit on one line and keep the portal's full message for the expanded view. */
function AppRow({ app, open, onToggle, act, busy, checking, onCheck, compact, master, data, onWorkspaceChange }) {
  const { SchoolMark, StatusSelect, fmtDate, daysUntil, relDays, ago, Chevron, detailsHint } = window.cfApp;
  const next = app.nextDate;
  const hint = open ? "" : detailsHint(app);
  const soon = next && daysUntil(next.date) <= 7;
  const summary = app.portal && app.portal.ok ? portalSummary(app) : null;
  const said = summary ? `${summary.quoted ? `“${summary.text}”` : summary.text} · ${ago(app.portal.checkedAt)}` : app.login ? "Not checked yet" : "";
  return (
    <li className={"cf-app-row" + (compact ? " cf-app-row--compact" : "")}>
      <SchoolMark name={app.name} logo={app.logo} />
      <div className="cf-app-row__head">
        <h3 className="cf-app-row__name">{app.name}</h3>
        <div className="cf-app-row__meta">
          {app.round ? <span>{app.round}{app.roundFromPortal && !compact ? " (portal)" : ""}</span> : null}
          {next ? <span className={soon ? "is-soon" : ""}>{compact ? "" : `${next.kind} `}<b>{fmtDate(next.date)}</b> {compact ? (next.kind === "Decision" ? "decision" : "due") + (next.estimated ? " (est.)" : "") :next.estimated ? "· estimated from last year" : `· ${relDays(next.date)}`}</span> : null}
          {!next && app.deadline && app.stage === "working" ? <span>Deadline <b>{fmtDate(app.deadline)}</b> · passed</span> : null}
          {compact && said && !checking ? <span className="cf-app-row__said">{said}</span> : null}
          {checking ? <span>Checking portal…</span> : null}
          {hint ? <span className="cf-app-row__hint">{hint}</span> : null}
        </div>
      </div>
      <div className="cf-app-row__side">
        <StatusSelect app={app} disabled={busy} onChange={(status) => act({ action: "update", id: app.id, edit: { status } }, `${app.name}: status updated.`)} />
        <button type="button" className="cf-more-btn" aria-expanded={open} aria-controls={`app-${app.id}`} onClick={onToggle}>
          <span className="cf-sr-only">{open ? "Hide" : "Show"} details for {app.name}</span><Chevron />
        </button>
      </div>
      {!compact || open ? <PortalLine app={app} odds={window.cfOdds ? window.cfOdds.oddsForApp(data, app) : null} /> : null}
      {open ? <div id={`app-${app.id}`} className="cf-app-row__more"><AppDetails app={app} act={act} busy={busy} checking={checking} onCheck={onCheck} master={master} data={data} onWorkspaceChange={onWorkspaceChange} /></div> : null}
    </li>
  );
}

/**
 * Portals: the schools whose applicant portal you've added, which means everything you've submitted or saved
 * a login for. Schools you haven't submitted yet live on Progress.
 */
function Applications({ data, tracker, onTrackerChange, onWorkspaceChange }) {
  const { APP_STAGES } = window.cfApp;
  // A school still being written that was just added here stays shown, so its portal login can be saved.
  const [pinned, setPinned] = React.useState(null);
  const apps = tracker.apps.filter((a) => a.stage !== "working" || (a.login && a.login.hasPassword) || a.id === pinned);
  const notYet = tracker.apps.length - apps.length;
  const [panel, setPanel] = React.useState(() => (window.location.hash.indexOf("import") > -1 ? "import" : apps.length ? null : "add"));
  const [open, setOpen] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [checking, setChecking] = React.useState({});
  const [progress, setProgress] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");
  const [master, setMaster] = React.useState(null);
  React.useEffect(() => {
    window.cfApi.applications().then((j) => { if (j && j.master) setMaster(j.master); }).catch(() => undefined);
  }, []);

  const act = async (body, message) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const j = await window.cfApi.applications(body);
      if (j.data) onTrackerChange(j.data);
      if (j.master) setMaster(j.master);
      if (message) setNotice(message);
      return j;
    } catch (e) {
      setError(e.message);
      return null;
    } finally { setBusy(false); }
  };

  const checkSome = async (list) => {
    const queue = [...list];
    let done = 0;
    let failed = 0;
    setNotice("");
    setChecking(Object.fromEntries(list.map((a) => [a.id, true])));
    const worker = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        try {
          const j = await window.cfApi.applications({ action: "check", ids: [a.id] });
          if (j.data) onTrackerChange(j.data);
          const c = j.checked && j.checked[0];
          if (c && (c.lastFailure || (c.portal && !c.portal.ok))) failed++;
        } catch (e) { failed++; }
        done++;
        setChecking((c) => { const n = { ...c }; delete n[a.id]; return n; });
        if (list.length > 1) setProgress(`Checked ${done} of ${list.length}…`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    setProgress("");
    setNotice(failed ? `Checked ${list.length}. ${failed} couldn’t be read; see each school for why.` : `Checked ${list.length} portal${list.length === 1 ? "" : "s"}.`);
  };

  const withLogin = apps.filter((a) => a.login && a.login.hasPassword);
  const checkingAny = Object.keys(checking).length > 0;
  const counts = APP_STAGES.map((s) => [s, apps.filter((a) => a.stage === s.id).length]).filter(([, n]) => n);
  // Schools with something to act on lead the page in full; the rest are one line each, by stage.
  // The open school stays in the section it was opened in, so a check that changes it can't remount the editor mid-edit.
  const inAttention = (a) => (open && open.id === a.id ? open.attention : window.cfApp.attentionOf(a).length > 0);
  const attention = apps.filter(inAttention);
  const quiet = apps.filter((a) => !inAttention(a));
  const bySoonest = (a, b) => ((a.nextDate && a.nextDate.date) || "9999").localeCompare((b.nextDate && b.nextDate.date) || "9999") || a.name.localeCompare(b.name);
  // Unopened decisions first, then failed checks, then missing documents.
  const RANK = { decision: 0, check: 1, missing: 2 };
  const rankOf = (a) => Math.min(3, ...window.cfApp.attentionOf(a).map((r) => RANK[r.id]));
  const byUrgency = (a, b) => rankOf(a) - rankOf(b) || bySoonest(a, b);

  const onAdd = async (input) => {
    // A portal exists once you've applied, so a school added here starts as submitted.
    const j = await window.cfApi.applications({ action: "add", status: "submitted", ...input });
    onTrackerChange(j.data);
    // Already tracked on Progress and not submitted: the add keeps its status, so open its login form here.
    const stillWriting = j.app.stage === "working" && !(j.app.login && j.app.login.hasPassword);
    if (stillWriting) { setPinned(j.app.id); setPanel(null); }
    setNotice(stillWriting
      ? `${j.app.name} is on Progress as ${j.app.statusLabel || "not submitted"}. Save its portal login below so Forge can check it, and set its status to Submitted once you have.`
      : j.app.portalFromEmail
        ? `${j.app.name} was already added from a forwarded email. Its portal link came from that email: check it and save it yourself.`
        : `${j.app.name} added. Set its round and deadline, and save the portal login so Forge can check it.`);
    setOpen({ id: j.app.id, attention: !stillWriting && window.cfApp.attentionOf(j.app).length > 0 });
    if (stillWriting) setTimeout(() => { const el = document.getElementById(`app-${j.app.id}`); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }, 60);
  };

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Portals</h1>
          <p className="cf-page-lede">Every applicant portal you’ve added: what each school says, what it’s still missing, and when to expect a decision. Forge signs in on your check schedule to keep this current.{notYet ? <React.Fragment>{" "}<a href="#progress">{notYet} school{notYet === 1 ? "" : "s"} you haven’t submitted yet {notYet === 1 ? "is" : "are"} on Progress.</a></React.Fragment> : null}</p>
        </div>
        <div className="cf-row-actions">
          {withLogin.length ? <Button variant="secondary" size="sm" disabled={checkingAny} onClick={() => checkSome(withLogin)}>{checkingAny ? "Checking portals…" : "Check portals now"}</Button> : null}
          <Button size="sm" onClick={() => setPanel(panel === "add" ? null : "add")}>I already applied — add its portal</Button>
        </div>
      </header>

      {counts.length ? <div className="cf-apps-summary" aria-label="Summary">{counts.map(([s, n]) => <span key={s.id}><strong>{n}</strong>{s.label.toLowerCase()}</span>)}</div> : null}

      {busy || progress || notice ? <div role="status" aria-live="polite" className="cf-apps-progress">{busy ? "Saving…" : progress || notice}</div> : <div role="status" aria-live="polite" className="cf-sr-only" />}
      {error ? <div role="alert" className="cf-notice">{error}</div> : null}

      {panel === "import" ? <ImportCollegeApps onClose={() => { setPanel(null); if (window.location.hash.indexOf("import") > -1) window.location.hash = "applications"; }} onImported={(j) => {
        onTrackerChange(j.data);
        setPanel(null);
        setNotice(j.added || j.linked ? `Brought over ${j.added} school${j.added === 1 ? "" : "s"}${j.linked ? ` and ${j.linked} login${j.linked === 1 ? "" : "s"} for schools already here` : ""}.` : "Everything from College Apps is already here.");
      }} /> : null}
      {panel === "forward" ? <ForwardEmails onClose={() => setPanel(null)} master={master} /> : null}
      {panel === "master" ? <window.MasterLoginPanel master={master} apps={tracker.apps} act={act} busy={busy} onClose={() => setPanel(null)} /> : null}
      {panel === "add" ? <AddSchool title="Add a portal" tracked={apps} shortlist={data.colleges} onAdd={onAdd} onClose={() => setPanel(null)} /> : null}

      {apps.length === 0 ? (
        panel !== "import" ? (
          <div className="cf-empty">
            No portals yet. Once you submit, add the school here and save its portal login.{" "}
            <button type="button" className="cf-link-btn" onClick={() => setPanel("import")}>Coming from College Apps? Bring your schools over.</button>{" "}
            <button type="button" className="cf-link-btn" onClick={() => setPanel("forward")}>Or forward a school’s portal setup email.</button>
          </div>
        ) : null
      ) : (
        <React.Fragment>
          <div className="cf-apps-toolbar">
            <div className="cf-apps-toolbar__views">
              <a className="cf-link-btn" href="#timeline/dates">Every deadline and decision date is on the Timeline →</a>
            </div>
            <div className="cf-apps-toolbar__auto">
              <span className="cf-apps-autocheck">
                <label className="cf-apps-auto">
                  <input type="checkbox" checked={tracker.autocheck} disabled={busy} onChange={(e) => act({ action: "autocheck", on: e.target.checked }, e.target.checked ? "Automatic checks are on." : "Automatic checks are off.")} />
                  Check portals
                </label>
                {tracker.autocheck ? <window.CheckSchedule schedule={tracker.schedule} act={act} busy={busy} /> : <span className="cf-apps-schedule__next">automatically</span>}
              </span>
              <label className="cf-apps-auto">
                <input type="checkbox" checked={tracker.emails !== false} disabled={busy || !tracker.autocheck} onChange={(e) => act({ action: "emails", on: e.target.checked }, e.target.checked ? "Forge will email you when a portal changes." : "Portal emails are off.")} />
                Email me on changes
              </label>
            </div>
          </div>
          {[{ id: "attention", label: "Needs attention", list: attention }].concat(APP_STAGES.map((s) => ({ id: s.id, label: s.label, list: quiet.filter((a) => a.stage === s.id), compact: true }))).map((group) => {
            if (!group.list.length) return null;
            const list = group.list.slice().sort(group.compact ? bySoonest : byUrgency);
            return (
              <section key={group.id} className="cf-apps-group" aria-labelledby={`stage-${group.id}`}>
                <div className="cf-apps-group__head"><h2 id={`stage-${group.id}`}>{group.label}</h2><span>{list.length}</span></div>
                <ul className="cf-apps-list">
                  {list.map((a) => <AppRow key={a.id} app={a} compact={group.compact} open={!!open && open.id === a.id} onToggle={() => setOpen(open && open.id === a.id ? null : { id: a.id, attention: !group.compact })} act={act} busy={busy} checking={!!checking[a.id]} onCheck={() => checkSome([a])} master={master} data={data} onWorkspaceChange={onWorkspaceChange} />)}
                </ul>
              </section>
            );
          })}
          {panel !== "import" ? <p className="cf-help">Coming from College Apps? <button type="button" className="cf-link-btn" onClick={() => setPanel("import")}>Bring your schools over</button>.</p> : null}
          {panel !== "forward" ? <p className="cf-help">Got an email from a school about setting up your portal? <button type="button" className="cf-link-btn" onClick={() => setPanel("forward")}>Forward it to Forge</button>.</p> : null}
          {panel !== "master" ? <p className="cf-help">Use the same password on many portals? <button type="button" className="cf-link-btn" onClick={() => setPanel("master")}>{master && master.on ? "Manage your master login" : "Save a master login"}</button>.</p> : null}
        </React.Fragment>
      )}
    </div>
  );
}

window.Applications = Applications;
window.AppDetails = AppDetails;
