const { Button } = window.CollegeForgeDesignSystem_e95e63;

/** Portals settings beyond on/off: the check schedule, the master login, and finishing a forwarded set-up. */

const browserZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; }
};

/** "15:00" as the viewer writes times ("3:00 PM"). */
function clockLabel(hhmm) {
  const [h] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const listOf = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** How often automatic checks run and from what hour, inline in the toolbar; the times they land on are the next label's tooltip. */
function CheckSchedule({ schedule, act, busy }) {
  if (!schedule) return null;
  const zone = browserZone();
  const save = (change) => act({
    action: "schedule",
    everyHours: schedule.everyHours,
    startHour: schedule.startHour,
    timeZone: zone || schedule.timeZone,
    ...change,
  }, "Check schedule saved.");
  const next = schedule.nextAt ? new Date(schedule.nextAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", ...(zone ? {} : { timeZone: schedule.timeZone }) }) : "";
  const otherZone = zone && zone !== schedule.timeZone;
  const times = `Checks around ${listOf(schedule.times.map(clockLabel))}${otherZone ? ` (${schedule.timeZone} time)` : ""}. Checking by hand doesn’t change these times.`;
  return (
    <span className="cf-apps-schedule">
      <select aria-label="How often to check" value={schedule.everyHours} disabled={busy} onChange={(e) => save({ everyHours: Number(e.target.value) })}>
        {[8, 12, 24].map((h) => <option key={h} value={h}>{h === 24 ? "once a day" : `every ${h} hours`}</option>)}
      </select>
      <span>from</span>
      <select aria-label="First check of the day" value={schedule.startHour} disabled={busy} onChange={(e) => save({ startHour: Number(e.target.value) })}>
        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{clockLabel(`${h}:00`)}</option>)}
      </select>
      {next ? <span className="cf-apps-schedule__next cf-nums" title={times}>· next {next}</span> : null}
      {otherZone ? <button type="button" className="cf-link-btn" disabled={busy} onClick={() => save({ timeZone: zone })}>Use my time zone</button> : null}
    </span>
  );
}

/** Set, replace or forget the master login, and apply it to every catalog portal without one. */
function MasterLoginPanel({ master, apps, act, busy, onClose }) {
  const [form, setForm] = React.useState({ username: (master && master.username) || "", password: "" });
  const without = apps.filter((a) => a.collegeId && a.portalUrl && !(a.login && a.login.hasPassword)).length;
  const save = (e) => {
    e.preventDefault();
    act({ action: "master-login", username: form.username, password: form.password }, master && master.on ? "Master login replaced." : "Master login saved.")
      .then((ok) => ok && setForm({ ...form, password: "" }));
  };
  return (
    <section className="cf-panel cf-panel--soft" aria-labelledby="master-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 id="master-title">Master login</h2>
        <button type="button" className="cf-link-btn" onClick={onClose}>Close</button>
      </div>
      <p className="cf-help">
        If you use the same username and password on many portals, save it once here. It’s encrypted like every portal login and only used on schools you turn it on for.
        {master && master.on ? ` In use on ${master.appCount} school${master.appCount === 1 ? "" : "s"}.` : ""}
      </p>
      <form className="cf-fields" style={{ alignItems: "end" }} onSubmit={save}>
        <label className="cf-field">Username or email
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" name="master-user" placeholder="Your account email" maxLength={254} />
        </label>
        <label className="cf-field">Password
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" name="master-pass" placeholder={master && master.on ? "Saved. Type to replace" : ""} maxLength={256} />
        </label>
        <div className="cf-row-actions">
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !form.password}>{master && master.on ? "Replace" : "Save"}</Button>
          {master && master.on ? <button type="button" className="cf-link-btn" disabled={busy} onClick={() => act({ action: "forget-master" }, "Master login removed.")}>Forget it</button> : null}
        </div>
      </form>
      {master && master.on ? (
        <React.Fragment>
          <p className="cf-help">Changing it here doesn’t change it on your portals. Change it on the portals first, or checks will start failing.</p>
          <div className="cf-row-actions">
            <Button size="sm" disabled={busy || !without} onClick={() => act({ action: "apply-master-all" }, "Master login turned on for those portals.")}>
              Use for all portals without a login{without ? ` (${without})` : ""}
            </Button>
          </div>
          {!without ? <p className="cf-help">Every portal Forge knows already has a login. Turn the master on for other schools one at a time in their details.</p> : null}
        </React.Fragment>
      ) : null}
    </section>
  );
}

/** "Use my master login" for one school. An own login typed below replaces it. */
function MasterToggle({ app, master, act, busy }) {
  if (!master || !master.on) return null;
  const on = !!(app.login && app.login.source === "master");
  return (
    <label className="cf-check" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
      <input type="checkbox" checked={on} disabled={busy || (!on && !app.portalUrl)} onChange={(e) => act({ action: "use-master", id: app.id, on: e.target.checked }, e.target.checked ? `${app.name} uses your master login.` : `${app.name} no longer uses your master login.`)} />
      <span>Use my master login{!app.portalUrl ? " (add the portal link first)" : ""}</span>
    </label>
  );
}

/** What a forwarded set-up email left: shown only when the student asks for it. */
function FinishSetup({ app }) {
  const [details, setDetails] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  if (!app.setupWaiting) return null;
  const reveal = async () => {
    setBusy(true);
    setError("");
    try {
      const j = await window.cfApi.applications({ action: "setup-details", id: app.id });
      setDetails(j.setup);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <h3 className="cf-subhead">Finish setup</h3>
      <p className="cf-help" style={{ marginBottom: 8 }}>
        You forwarded {app.name}’s set-up email, but Forge couldn’t finish{details && details.reason ? `: ${details.reason}` : "."} The details from that email are kept here, encrypted, until this portal’s login works.
      </p>
      {!details ? <Button size="sm" variant="secondary" disabled={busy} onClick={reveal}>{busy ? "Opening…" : "Show PIN, link and password"}</Button> : (
        <dl className="cf-setup-details">
          {details.username ? <React.Fragment><dt>Username</dt><dd>{details.username}</dd></React.Fragment> : null}
          {details.pin ? <React.Fragment><dt>PIN</dt><dd className="cf-mono">{details.pin}</dd></React.Fragment> : null}
          {details.password ? <React.Fragment><dt>Password Forge made</dt><dd className="cf-mono">{details.password}</dd></React.Fragment> : null}
          {details.linkChecked === true && details.link && /^https:\/\//.test(details.link) ? <React.Fragment><dt>Link</dt><dd><a href={details.link} target="_blank" rel="noopener noreferrer">Open the set-up page ↗</a></dd></React.Fragment> : null}
        </dl>
      )}
      {error ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>{error}</p> : null}
    </div>
  );
}

window.CheckSchedule = CheckSchedule;
window.MasterLoginPanel = MasterLoginPanel;
window.MasterToggle = MasterToggle;
window.FinishSetup = FinishSetup;
