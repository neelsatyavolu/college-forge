/**
 * GPTZero in the hub: the Settings card that connects the student's own GPTZero account (app/api/gptzero),
 * and the essay editor's "Check for AI writing" panel (app/api/gptzero/scan). The server reads the saved
 * draft, so the panel waits until the draft has saved.
 */

async function gptzeroApi(url, body) {
  const res = await fetch(url, body ? {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : { credentials: "same-origin", cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new Error((j && j.error) || "That didn’t work. Try again.");
  return j;
}

/** One status request per page load, shared by the Settings card and every essay. */
let gptzeroStatus = null;
const loadGptzeroStatus = (force) => {
  if (force || !gptzeroStatus) gptzeroStatus = gptzeroApi("/api/gptzero").then((j) => j.data).catch((e) => { gptzeroStatus = null; throw e; });
  return gptzeroStatus;
};

function GptzeroPanel({ Panel }) {
  const { Button } = window.CollegeForgeDesignSystem_e95e63;
  const [status, setStatus] = React.useState(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  React.useEffect(() => { loadGptzeroStatus().then(setStatus, (e) => setErr(e.message)); }, []);

  const send = async (body) => {
    setBusy(true);
    setErr("");
    try {
      const j = await gptzeroApi("/api/gptzero", body);
      gptzeroStatus = Promise.resolve(j.data);
      setStatus(j.data);
      setPassword("");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const field = { padding: "9px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)", fontSize: 14 };

  return (
    <Panel title="GPTZero">
      <div style={{ display: "grid", gap: 12 }}>
        <p className="cf-help" style={{ color: "var(--body)" }}>Check essay drafts for AI writing with your own GPTZero account. Each check sends that essay’s text to GPTZero and uses words from your GPTZero plan. Forge keeps your GPTZero password encrypted and never shows it again. Accounts that sign in to GPTZero with Google need a GPTZero password first.</p>
        {status === null && !err ? <p className="cf-help">Loading…</p> : null}
        {status && status.connected ? (
          <div className="cf-row-actions">
            <span className="cf-help" style={{ color: "var(--body)" }}>Connected as <strong style={{ color: "var(--ink)" }}>{status.email}</strong></span>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => send({ action: "disconnect" })}>{busy ? "Disconnecting…" : "Disconnect"}</Button>
          </div>
        ) : null}
        {status && !status.connected ? (
          <form onSubmit={(e) => { e.preventDefault(); if (email.trim() && password) send({ action: "connect", email: email.trim(), password }); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--ink)", flex: "1 1 220px" }}>GPTZero email
              <input type="email" required maxLength={254} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--ink)", flex: "1 1 180px" }}>Password
              <input type="password" required maxLength={256} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} style={field} />
            </label>
            <Button size="sm" type="submit" disabled={busy || !email.trim() || !password} style={{ height: 40 }}>{busy ? "Connecting…" : "Connect"}</Button>
          </form>
        ) : null}
        {err ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>{err}</p> : null}
      </div>
    </Panel>
  );
}

const VERDICT_WORDS = { ai: "Likely AI-written", mixed: "Mixed human and AI", human: "Likely human-written" };
const pct = (x) => `${Math.round((x || 0) * 100)}%`;

function AiBars({ r }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "var(--muted)" }}>
      {[["AI", r.ai, "var(--error)"], ["Mixed", r.mixed, "var(--accent-amber)"], ["Human", r.human, "var(--accent-teal)"]].map(([label, v, color]) => (
        <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {label}
          <span aria-hidden style={{ width: 60, height: 5, borderRadius: "var(--radius-pill)", background: "var(--surface-cream-strong)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: pct(v), background: color }} />
          </span>
          <span className="cf-nums" style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{pct(v)}</span>
        </span>
      ))}
    </div>
  );
}

/** The editor's AI check: button, last result, and the sentences GPTZero flagged (shown, not stored). */
function AiCheckPanel({ essayId, words, check, pending, onFlush, onWorkspaceChange }) {
  const { Button } = window.CollegeForgeDesignSystem_e95e63;
  const [status, setStatus] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [result, setResult] = React.useState(null);
  React.useEffect(() => { loadGptzeroStatus().then(setStatus, () => setStatus({ connected: false })); }, []);
  React.useEffect(() => { setResult(null); setErr(""); }, [essayId]);

  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      if (onFlush) await onFlush();
      const j = await gptzeroApi("/api/gptzero/scan", { essayId });
      setResult(j.result);
      if (onWorkspaceChange && j.data) onWorkspaceChange(j.data);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const shown = result || check;
  const connected = status && status.connected;
  return (
    <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)", background: "var(--surface-soft)", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--ink)" }}>
          {shown && shown.verdict && VERDICT_WORDS[shown.verdict] ? <strong>{VERDICT_WORDS[shown.verdict]}</strong> : <strong>AI writing check</strong>}
          {!result && check ? <span className="cf-nums" style={{ color: "var(--muted)" }}> · checked {new Date(check.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} at {check.words} words</span> : null}
        </span>
        {status === null ? null : connected ? (
          <Button size="sm" variant="secondary" disabled={busy || pending || words < 50} onClick={run}>{busy ? "Checking…" : shown ? "Check again" : "Check for AI writing"}</Button>
        ) : (
          <a className="cf-link-btn" href="#settings">Connect GPTZero in Settings</a>
        )}
      </div>
      {shown && shown.verdict ? <AiBars r={shown} /> : null}
      {result && result.message ? <p style={{ margin: 0, fontSize: 13, color: "var(--body)" }}>{result.message}</p> : null}
      {result && result.flagged.length ? (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--ink)" }}>{result.flagged.length} of {result.sentences} sentences flagged as AI</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
            {result.flagged.map((s, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: "var(--body)" }}>
                <mark style={{ background: "color-mix(in srgb, var(--accent-amber) 28%, transparent)", color: "inherit" }}>{s.sentence}</mark>
                <span className="cf-nums" style={{ marginLeft: 6, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>{pct(s.prob)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {err ? <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--error)" }}>{err}</p> : null}
      <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
        {connected
          ? `Your essay text is sent to GPTZero. Detectors make mistakes, more so on short or heavily edited text${words < 50 ? ". Write at least 50 words to check" : ""}.`
          : "Checks use your own GPTZero account."}
      </p>
    </div>
  );
}

window.GptzeroPanel = GptzeroPanel;
window.AiCheckPanel = AiCheckPanel;
