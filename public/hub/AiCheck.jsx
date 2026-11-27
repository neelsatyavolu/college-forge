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
        {status && !status.connected && status.failed ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>{status.error}</p> : null}
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

/**
 * The editor's AI check, one strip under the prompt: verdict, bars, a toggle for highlighting the sentences
 * GPTZero flagged (onFlagged hands them to the editor; they're shown, not stored), and the check button.
 */
function AiCheckPanel({ essayId, words, check, pending, onFlush, onWorkspaceChange, onFlagged, highlighting, onToggleHighlight }) {
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
      if (onFlagged) onFlagged((j.result && j.result.flagged || []).map((f) => f.sentence));
      if (onWorkspaceChange && j.data) onWorkspaceChange(j.data);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const shown = result || check;
  const connected = status && status.connected;
  const flaggedCount = result ? (result.flaggedCount || result.flagged.length) : 0;
  const privacy = `Your essay text is sent to GPTZero with your own account. Detectors make mistakes, more so on short or heavily edited text.${result && result.message ? ` GPTZero: ${result.message}` : ""}`;
  return (
    <div className="cf-ai-strip">
      <span className="cf-ai-strip__verdict" title={privacy}>
        {shown && shown.verdict && VERDICT_WORDS[shown.verdict] ? VERDICT_WORDS[shown.verdict] : "AI writing check"}
        {!result && check ? <span className="cf-nums cf-ai-strip__meta"> · {new Date(check.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, {check.words} words</span> : null}
      </span>
      {shown && shown.verdict ? <AiBars r={shown} /> : null}
      {flaggedCount ? (
        <button type="button" className="cf-link-btn" aria-pressed={!!highlighting} onClick={onToggleHighlight}>
          {highlighting ? "Hide" : "Highlight"} {flaggedCount} flagged sentence{flaggedCount === 1 ? "" : "s"}
        </button>
      ) : result ? <span className="cf-ai-strip__meta">No sentences flagged</span> : null}
      <span className="cf-ai-strip__action">
        {status === null ? null : connected ? (
          <Button size="sm" variant="secondary" disabled={busy || pending || words < 50} title={words < 50 ? "Write at least 50 words to check." : privacy} onClick={run}>
            {busy ? "Checking…" : shown ? "Check again" : "Check for AI writing"}
          </Button>
        ) : (
          <a className="cf-link-btn" href="#settings/gptzero">{status.failed ? "GPTZero sign-in failed. Fix it in Settings" : "Connect GPTZero to check for AI writing"}</a>
        )}
      </span>
      {err ? <p role="alert" className="cf-ai-strip__error">{err}</p> : null}
    </div>
  );
}

window.GptzeroPanel = GptzeroPanel;
window.AiCheckPanel = AiCheckPanel;
