// The progress page: every application by round, with flags, follow-ups and decisions.
// Used by the hub's Progress tab (editable) and by progress share links (read-only).

const UC_NAME = /^(university of california|uc )/i;
const EARLY = ["ED", "EA", "REA"];

function groupOf(app) {
  if (UC_NAME.test(app.name)) return "uc";
  if (EARLY.includes(app.round)) return "early";
  if (app.round === "RD" || app.round === "ED2") return "rd";
  if (app.round === "Rolling") return "rolling";
  return "other";
}

/** "Nov 1" when most early applications share one deadline, otherwise "Early". */
function earlyLabel(apps) {
  const { fmtDate } = window.cfApp;
  const dates = apps.map((a) => a.deadline).filter(Boolean);
  if (!dates.length) return "Early";
  const counts = dates.reduce((m, d) => ({ ...m, [d]: (m[d] || 0) + 1 }), {});
  const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n / apps.length >= 0.6 ? fmtDate(top) : "Early";
}

function StatusBadge({ app }) {
  const { statusMeta } = window.cfApp;
  const meta = statusMeta(app.status);
  return <span className="cf-badge" style={{ "--tone": meta.tone }}>{meta.label}</span>;
}

function StatusBadgeSelect({ app, disabled, onChange }) {
  const { APP_STATUSES, statusMeta } = window.cfApp;
  return (
    <span className="cf-badge cf-badge--select" style={{ "--tone": statusMeta(app.status).tone }}>
      <select aria-label={`Status for ${app.name}`} value={app.status} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {APP_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </span>
  );
}

/** The middle column: what date matters for this application right now. */
function whenText(app) {
  const { fmtDate, daysUntil } = window.cfApp;
  if (app.stage === "working") {
    if (!app.deadline) return { text: "No deadline set" };
    const n = daysUntil(app.deadline);
    return { text: n >= 0 ? `${fmtDate(app.deadline)} · ${n === 0 ? "today" : `in ${n}d`}` : `${fmtDate(app.deadline)} · passed`, soon: n >= 0 && n <= 7, late: n < 0 };
  }
  if (app.stage === "waiting") {
    if (app.submittedAt) return { text: `submitted ${fmtDate(app.submittedAt)}` };
    if (app.decisionDate) return { text: `decision ${fmtDate(app.decisionDate.date)}${app.decisionDate.estimated ? " (est.)" : ""}` };
    return { text: "submitted" };
  }
  if (app.submittedAt) return { text: `submitted ${fmtDate(app.submittedAt)}` };
  return { text: "" };
}

function FollowUpLines({ app, editable, act, busy }) {
  const { fmtDate } = window.cfApp;
  if (!app.followUps || !app.followUps.length) return null;
  return (
    <ul className="cf-followups">
      {app.followUps.map((f) => (
        <li key={f.id}>
          {editable ? (
            <label>
              <input type="checkbox" disabled={busy} onChange={() => act({ action: "followup-set", id: app.id, followUpId: f.id, done: true }, "Follow-up done.")} />
              <span><span aria-hidden="true">→ </span>{f.text}{f.due ? ` · ${fmtDate(f.due)}` : ""}</span>
            </label>
          ) : <span><span aria-hidden="true">→ </span>{f.text}{f.due ? ` · ${fmtDate(f.due)}` : ""}</span>}
        </li>
      ))}
    </ul>
  );
}

function ProgressRow({ app, editable, act, busy, open, onToggle, renderDetails, checking }) {
  const { SchoolMark, Chevron } = window.cfApp;
  const when = whenText(app);
  return (
    <li className="cf-prow">
      <div className="cf-prow__main">
        <SchoolMark name={app.name} logo={app.logo} />
        {editable && renderDetails ? (
          <button type="button" className="cf-prow__name" aria-expanded={open} aria-controls={`app-${app.id}`} onClick={onToggle}>
            {app.name}<Chevron />
          </button>
        ) : <span className="cf-prow__name">{app.name}</span>}
        <span className="cf-prow__meta">
          <span className="cf-prow__round">{app.round || "—"}</span>
          <span className={"cf-prow__when" + (when.soon ? " is-soon" : "") + (when.late ? " is-late" : "")}>{checking ? "checking portal…" : when.text}</span>
        </span>
        <span className="cf-prow__status">{editable ? <StatusBadgeSelect app={app} disabled={busy} onChange={(status) => act({ action: "update", id: app.id, edit: { status } }, `${app.name}: status updated.`)} /> : <StatusBadge app={app} />}</span>
      </div>
      <div className="cf-prow__sub">
        {app.decision.state === "hidden" ? <div className="cf-prow__note is-decision">{editable ? <a href="#decisions">A decision is posted. Open it on Decisions →</a> : "A decision is posted in the portal."}</div> : null}
        {app.missing && app.missing.length ? <div className="cf-prow__note">Portal still needs: {app.missing.slice(0, 4).join(", ")}{app.missing.length > 4 ? `, +${app.missing.length - 4} more` : ""}</div> : null}
        <FollowUpLines app={app} editable={editable} act={act} busy={busy} />
        {open && renderDetails ? <div id={`app-${app.id}`}>{renderDetails(app)}</div> : null}
      </div>
    </li>
  );
}

function Rows({ apps, ...rest }) {
  if (!apps.length) return <div className="cf-empty">Nothing here yet.</div>;
  return <ul className="cf-plist">{apps.map((a) => <ProgressRow key={a.id} {...rest} app={a} open={rest.openId === a.id} onToggle={() => rest.onToggle && rest.onToggle(a.id)} checking={!!(rest.checking && rest.checking[a.id])} />)}</ul>;
}

const byDeadline = (a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || a.name.localeCompare(b.name);
const STAGE_ORDER = { working: 0, waiting: 1, admitted: 2, denied: 3, closed: 4 };
const byProgress = (a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || byDeadline(a, b);

function ProgressView({ tracker, editable, act, busy, openId, onToggle, renderDetails, checking, initialTab }) {
  const { fmtDate, statusMeta, SchoolMark } = window.cfApp;
  const apps = tracker.apps;
  const flags = tracker.flags || [];
  const groups = { early: [], rd: [], rolling: [], uc: [], other: [] };
  apps.forEach((a) => groups[groupOf(a)].push(a));
  const decided = apps.filter((a) => a.decision.state !== "none");
  const followUps = apps.flatMap((a) => (a.followUps || []).map((f) => ({ ...f, app: a }))).sort((x, y) => (x.due || "9999").localeCompare(y.due || "9999"));
  const tabs = [
    { id: "overview", label: "Overview", count: apps.length },
    { id: "decisions", label: "Decisions", count: decided.length },
    { id: "early", label: earlyLabel(groups.early), count: groups.early.length },
    { id: "rolling", label: "Rolling", count: groups.rolling.length },
    { id: "rd", label: "Regular decision", count: groups.rd.length },
    { id: "uc", label: "UCs", count: groups.uc.length },
    { id: "followups", label: "Follow-ups", count: followUps.length },
    { id: "other", label: "Other", count: groups.other.length },
  ].filter((t) => t.id === "overview" || t.count > 0);
  const [tab, setTab] = React.useState(initialTab && tabs.some((t) => t.id === initialTab) ? initialTab : "overview");
  const current = tabs.some((t) => t.id === tab) ? tab : "overview";

  const submitted = apps.filter((a) => a.stage !== "working" && a.status !== "withdrawn").length;
  const working = apps.filter((a) => a.stage === "working").sort(byDeadline);
  const nextDue = working.find((a) => a.deadline && a.deadline >= window.cfApp.todayIso());
  const dueThatDay = nextDue ? working.filter((a) => a.deadline === nextDue.deadline).length : 0;
  const rowProps = { editable, act, busy, openId, onToggle, renderDetails, checking };

  return (
    <div className="cf-progress">
      <div className="cf-ptabs" role="tablist" aria-label="Applications">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={current === t.id} className={"cf-ptab" + (current === t.id ? " is-active" : "")} onClick={() => setTab(t.id)}>
            {t.label}<span className="cf-ptab__n">{t.count}</span>
          </button>
        ))}
      </div>

      {current === "overview" ? (
        <div role="tabpanel">
          <p className="cf-psummary">
            <strong>{submitted}/{apps.length}</strong> submitted
            {nextDue ? <React.Fragment><span aria-hidden="true"> · </span><strong>{dueThatDay}</strong> due {fmtDate(nextDue.deadline)}</React.Fragment> : null}
            {flags.length ? <React.Fragment><span aria-hidden="true"> · </span><strong>{flags.length}</strong> flag{flags.length === 1 ? "" : "s"}</React.Fragment> : null}
            {decided.length ? <React.Fragment><span aria-hidden="true"> · </span><strong>{decided.length}</strong> decision{decided.length === 1 ? "" : "s"}</React.Fragment> : null}
          </p>
          {flags.length ? (
            <section className="cf-psection" aria-labelledby="p-flags">
              <h2 id="p-flags" className="cf-psection__title">Flags</h2>
              <ul className="cf-flags">
                {flags.map((f) => (
                  <li key={f.id}>
                    <span className="cf-flags__mark" aria-hidden="true">!</span>
                    <span className="cf-flags__text">{f.text}</span>
                    <span className="cf-flags__scope">{f.scope}</span>
                    {editable ? <button type="button" className="cf-link-btn" disabled={busy} onClick={() => act({ action: "flag-resolve", flagId: f.id }, "Flag cleared.")}>Resolve</button> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="cf-psection" aria-labelledby="p-next">
            <h2 id="p-next" className="cf-psection__title">Next up</h2>
            {working.length ? <Rows apps={working} {...rowProps} /> : <div className="cf-empty">Every application is in. Decisions and follow-ups show up here as they come.</div>}
          </section>
          {apps.some((a) => a.stage === "waiting") ? (
            <section className="cf-psection" aria-labelledby="p-wait">
              <h2 id="p-wait" className="cf-psection__title">Waiting to hear</h2>
              <Rows apps={apps.filter((a) => a.stage === "waiting").sort(byDeadline)} {...rowProps} />
            </section>
          ) : null}
        </div>
      ) : null}

      {current === "decisions" ? (
        <div role="tabpanel">
          <ul className="cf-plist">
            {decided.map((a) => {
              const meta = statusMeta(a.status);
              const recorded = a.stage === "admitted" || a.stage === "denied" || a.status === "deferred" || a.status === "waitlisted";
              return (
                <li key={a.id} className="cf-prow">
                  <div className="cf-prow__main">
                    <SchoolMark name={a.name} logo={a.logo} />
                    <span className="cf-prow__name">{a.name}</span>
                    <span className="cf-prow__meta">
                      <span className="cf-prow__round">{a.round || "—"}</span>
                      <span className="cf-prow__when">{a.decision.state === "hidden" ? "posted, not opened yet" : a.decision.portalText ? `portal: ${a.decision.portalText}` : ""}</span>
                    </span>
                    <span className="cf-prow__status">{recorded ? <span className="cf-badge cf-badge--solid" style={{ "--tone": meta.tone }}>{meta.label}</span> : <span className="cf-badge" style={{ "--tone": "var(--coral)" }}>Posted</span>}</span>
                  </div>
                  {a.decision.state === "hidden" && editable ? <div className="cf-prow__sub"><a className="cf-prow__note is-decision" href="#decisions">Open it on Decisions →</a></div> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {["early", "rd", "rolling", "uc", "other"].includes(current) ? (
        <div role="tabpanel"><Rows apps={groups[current].slice().sort(byProgress)} {...rowProps} /></div>
      ) : null}

      {current === "followups" ? (
        <div role="tabpanel">
          <ul className="cf-plist">
            {followUps.map((f) => (
              <li key={f.id} className="cf-prow">
                <div className="cf-prow__main cf-prow__main--fu">
                  {editable ? <input type="checkbox" aria-label={`Mark done: ${f.text}`} disabled={busy} onChange={() => act({ action: "followup-set", id: f.app.id, followUpId: f.id, done: true }, "Follow-up done.")} /> : <span aria-hidden="true" className="cf-prow__arrow">→</span>}
                  <span className="cf-prow__fu">{f.text}<small>{f.app.name}</small></span>
                  <span className="cf-prow__when">{f.due ? fmtDate(f.due) : "no date"}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

window.ProgressView = ProgressView;
