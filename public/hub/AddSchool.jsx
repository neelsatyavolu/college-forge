const { Button } = window.CollegeForgeDesignSystem_e95e63;

const norm = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Search Forge's 330-school catalog, pick from the shortlist, or add any school by name. */
function AddSchool({ tracked, shortlist, onAdd, onClose }) {
  const { SchoolMark } = window.cfApp;
  const [query, setQuery] = React.useState("");
  const [catalog, setCatalog] = React.useState(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    inputRef.current && inputRef.current.focus();
    window.cfApi.catalog().then(setCatalog).catch(() => setError("Couldn't load the school list. You can still add a school by name."));
  }, []);

  const trackedIds = new Set(tracked.map((a) => a.collegeId).filter(Boolean));
  const trackedNames = new Set(tracked.map((a) => norm(a.name)));
  const trackedSlugs = new Set(tracked.map((a) => a.slug).filter(Boolean));
  const q = norm(query);
  const fromShortlist = (shortlist || [])
    .filter((c) => !trackedSlugs.has(c.slug) && !trackedNames.has(norm(c.name)))
    .filter((c) => !q || norm(c.name).includes(q))
    .slice(0, q ? 4 : 6);
  const fromCatalog = q.length < 2 || !catalog ? [] : catalog
    .filter((c) => !trackedIds.has(c.id) && (norm(c.name).includes(q) || c.id === q))
    .sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1) || a.name.localeCompare(b.name))
    .slice(0, 8);
  const exact = fromCatalog.some((c) => norm(c.name) === q) || fromShortlist.some((c) => norm(c.name) === q);

  const add = async (input) => {
    setBusy(true);
    setError("");
    try { await onAdd(input); } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <section className="cf-panel" aria-labelledby="add-school-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 id="add-school-title">Add a portal</h2>
        <button type="button" className="cf-link-btn" onClick={onClose}>Done</button>
      </div>
      <div className="cf-picker">
        <label className="cf-field">School name
          <input ref={inputRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing, like Michigan or Pomona" autoComplete="off" />
        </label>
        {fromShortlist.length || fromCatalog.length || q ? (
          <ul className="cf-picker__results" aria-label="Matching schools">
            {fromShortlist.map((c) => (
              <li key={"s-" + c.slug}><button type="button" disabled={busy} onClick={() => add({ name: c.name, slug: c.slug })}>
                <SchoolMark name={c.name} logo={null} /><span>{c.name}<small>On your shortlist</small></span>
              </button></li>
            ))}
            {fromCatalog.map((c) => (
              <li key={c.id}><button type="button" disabled={busy} onClick={() => add({ collegeId: c.id, name: c.name })}>
                <SchoolMark name={c.name} logo={c.logo} /><span>{c.name}<small>{c.state} · {c.portalName}</small></span>
              </button></li>
            ))}
            {q && !exact ? (
              <li><button type="button" disabled={busy} onClick={() => add({ name: query.trim() })}>
                <SchoolMark name={query} logo={null} /><span>Add “{query.trim()}”<small>Not in Forge’s list. You can add its portal link after.</small></span>
              </button></li>
            ) : null}
          </ul>
        ) : null}
      </div>
      {error ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>{error}</p> : null}
    </section>
  );
}

/** Brings a College Apps account over: schools, statuses, dates, notes and portal logins. */
function ImportCollegeApps({ onImported, onClose }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const j = await window.cfApi.applications({ action: "import-collegeapps", email, password });
      setPassword("");
      onImported(j);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };
  return (
    <section className="cf-panel cf-panel--soft" aria-labelledby="import-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 id="import-title">Bring your College Apps schools</h2>
        <button type="button" className="cf-link-btn" onClick={onClose}>Not now</button>
      </div>
      <p className="cf-help">Sign in with your College Apps email and password. Forge copies your schools, statuses, dates, notes and portal logins, then signs out of College Apps. Your College Apps password is used once and never saved.</p>
      <form onSubmit={submit} className="cf-fields" style={{ alignItems: "end" }}>
        <label className="cf-field">College Apps email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </label>
        <label className="cf-field">College Apps password
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <div><Button type="submit" disabled={busy || !email || !password}>{busy ? "Copying your schools…" : "Bring them over"}</Button></div>
      </form>
      {error ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>{error}</p> : null}
    </section>
  );
}

function ForwardEmails({ onClose }) {
  const [inbox, setInbox] = React.useState(null);
  const [birthdate, setBirthdate] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState("");
  const run = async (body) => {
    setBusy(true);
    setError("");
    try {
      const j = await window.cfApi.applications({ action: "inbox", ...body });
      setInbox(j.inbox);
      return j.inbox;
    } catch (err) {
      setError(err.message);
      return null;
    } finally { setBusy(false); }
  };
  React.useEffect(() => { run({}); }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(inbox.address); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) { /* the address is on screen to copy by hand */ }
  };
  return (
    <section className="cf-panel cf-panel--soft" aria-labelledby="forward-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 id="forward-title">Forward portal emails</h2>
        <button type="button" className="cf-link-btn" onClick={onClose}>Close</button>
      </div>
      <p className="cf-help">After you apply, schools email you a link or PIN to set up your applicant portal. Forward that email to your private address and Forge sets up the portal with a strong password, saves the login and starts checking it.</p>
      {inbox === null ? <p className="cf-help">{busy ? "Loading…" : null}</p> : inbox.address ? (
        <React.Fragment>
          <div className="cf-fields" style={{ alignItems: "end" }}>
            <label className="cf-field">Your forwarding address
              <input type="text" readOnly value={inbox.address} onFocus={(e) => e.target.select()} />
            </label>
            <div className="cf-row-actions">
              <Button size="sm" variant="secondary" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => run({ on: true, newAddress: true })}>New address</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => run({ on: false })}>Turn off</Button>
            </div>
          </div>
          <form className="cf-fields" style={{ alignItems: "end" }} onSubmit={(e) => { e.preventDefault(); run({ on: true, birthdate }).then((r) => { if (r) setBirthdate(""); }); }}>
            <label className="cf-field">Birthdate, for portals that ask for it{inbox.birthdate ? " (saved)" : ""}
              <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
            </label>
            <div><Button type="submit" size="sm" variant="secondary" disabled={busy || !birthdate}>Save birthdate</Button></div>
          </form>
        </React.Fragment>
      ) : (
        <div><Button size="sm" disabled={busy} onClick={() => run({ on: true })}>Get my forwarding address</Button></div>
      )}
      {error ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>{error}</p> : null}
    </section>
  );
}

window.AddSchool = AddSchool;
window.ImportCollegeApps = ImportCollegeApps;
window.ForwardEmails = ForwardEmails;
