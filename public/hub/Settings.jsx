const { Button, Badge, SectionLabel } = window.CollegeForgeDesignSystem_e95e63;

const AI_PREFS_KEY = "cf.ai";

function loadAiPrefs() {
  try {
    const raw = localStorage.getItem(AI_PREFS_KEY);
    if (!raw) return { preferred: "auto", grokModel: "", codexModel: "", opencodeModel: "" };
    const j = JSON.parse(raw);
    return {
      preferred: j.preferred || "auto",
      grokModel: j.grokModel || "",
      codexModel: j.codexModel || "",
      opencodeModel: j.opencodeModel || "",
    };
  } catch (e) {
    return { preferred: "auto", grokModel: "", codexModel: "", opencodeModel: "" };
  }
}

function saveAiPrefs(prefs) {
  try { localStorage.setItem(AI_PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
}

function Panel({ title, children, action }) {
  return (
    <section style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--hairline)", background: "var(--surface-soft)" }}>
        <h2 className="cf-display" style={{ margin: 0, fontSize: 20, color: "var(--ink)" }}>{title}</h2>
        {action}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </section>
  );
}

function Select({ label, value, onChange, options, hint }) {
  const hintId = React.useId();
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <select aria-label={label} aria-describedby={hint ? hintId : undefined} value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", maxWidth: 360, boxSizing: "border-box", padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)", fontSize: 14, fontFamily: "var(--font-body)" }}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint ? <div id={hintId} style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>{hint}</div> : null}
    </label>
  );
}

function StatusDot({ on }) {
  return (
    <span aria-hidden style={{
      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
      background: on ? "var(--accent-teal, #2a9d8f)" : "var(--muted-soft)",
      boxShadow: on ? "0 0 0 3px color-mix(in srgb, var(--accent-teal, #2a9d8f) 22%, transparent)" : "none",
    }} />
  );
}

/** Reusable OAuth connect flow for Grok / ChatGPT. */
function ConnectFlow({ provider, label, onDone }) {
  const [authUrl, setAuthUrl] = React.useState("");
  const [callback, setCallback] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const start = async () => {
    setErr(""); setBusy(true); setCallback("");
    try {
      const res = await fetch(`/api/auth/${provider}/start`, { method: "POST", credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not start sign-in.");
      setAuthUrl(j.authorizeUrl);
      window.open(j.authorizeUrl, "_blank", "noopener");
    } catch (e) { setErr(e.message); setAuthUrl(""); }
    setBusy(false);
  };

  const complete = async () => {
    if (!callback.trim()) return;
    setErr(""); setBusy(true);
    try {
      const res = await fetch(`/api/auth/${provider}/complete`, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback: callback.trim() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sign-in failed.");
      setAuthUrl(""); setCallback("");
      onDone();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  if (!authUrl) {
    return (
      <div>
        <Button size="sm" onClick={start} disabled={busy}>{busy ? "Opening…" : "Connect " + label}</Button>
        {err ? <p role="alert" style={{ margin: "8px 0 0", color: "var(--error)", fontSize: 12 }}>{err}</p> : null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 }}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55 }}>
        Authorizing <strong style={{ color: "var(--ink)" }}>{label}</strong> in a new tab
        {" "}(<a href={authUrl} target="_blank" rel="noopener noreferrer">reopen</a>):
        <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          <li>Approve the request.</li>
          <li>{provider === "grok" ? "Copy the displayed authorization code or full callback URL." : "You’ll land on a page that fails to load (localhost). That’s expected."}</li>
          <li>{provider === "grok" ? "Paste the code or URL below." : "Copy that page’s full URL and paste it below."}</li>
        </ol>
      </div>
      <input aria-label={label + " sign-in response"} autoComplete="off" spellCheck={false} onKeyDown={(e) => { if (e.key === "Enter" && !busy) { e.preventDefault(); complete(); } }} value={callback} onChange={(e) => setCallback(e.target.value)}
        placeholder={provider === "grok" ? "Paste the authorization code or callback URL…" : "Paste the localhost URL from the address bar…"}
        style={{ width: "100%", boxSizing: "border-box", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", padding: "8px 10px", fontSize: 12.5, color: "var(--ink)", outline: "none", fontFamily: "var(--font-body)" }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" onClick={complete} disabled={busy || !callback.trim()}>Finish sign-in</Button>
        <Button size="sm" variant="secondary" onClick={() => { setAuthUrl(""); setErr(""); }} disabled={busy}>Cancel</Button>
      </div>
      {err ? <p role="alert" style={{ margin: 0, color: "var(--error)", fontSize: 12 }}>{err}</p> : null}
    </div>
  );
}

function ProviderRow({ name, label, blurb, connected, models, modelValue, onModelChange, defaultModel, onDisconnect, connectSlot, busy }) {
  return (
    <div style={{ padding: "16px 0", borderTop: "1px solid var(--hairline-soft)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <StatusDot on={connected} />
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{label}</span>
            <Badge variant={connected ? "teal" : "cream"}>{connected ? "Connected" : "Not connected"}</Badge>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5, maxWidth: 420 }}>{blurb}</p>
        </div>
        <div style={{ flexShrink: 0 }}>
          {connected && onDisconnect ? (
            <Button size="sm" variant="secondary" onClick={onDisconnect} disabled={busy}>
              {busy ? "…" : "Disconnect"}
            </Button>
          ) : !connected ? connectSlot : null}
        </div>
      </div>
      {connected && models && models.length > 0 ? (
        <div style={{ marginTop: 12, maxWidth: 360 }}>
          <Select
            label="Model"
            value={modelValue || defaultModel || (models[0] && models[0].id) || ""}
            onChange={onModelChange}
            options={models.map((m) => ({
              value: m.id,
              label: m.label + (m.tier ? ` · ${m.tier}` : "") + (m.id === defaultModel ? " (default)" : ""),
            }))}
          />
        </div>
      ) : null}
    </div>
  );
}


function CopyField({ value, label }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (e) { setCopied(false); }
  };
  return (
    <div className="cf-copy">
      <code aria-label={label}>{value}</code>
      <Button size="sm" variant="secondary" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}

function AccountPanel({ account }) {
  const [busy, setBusy] = React.useState(false);
  const user = account && account.user;
  return (
    <Panel title="Account">
      <div style={{ display: "grid", gap: 12 }}>
        <p className="cf-help" style={{ color: "var(--body)" }}>Signed in with Xanom as <strong style={{ color: "var(--ink)" }}>{user ? user.email : "…"}</strong>. Your applications, essays and lists follow this account to any device.</p>
        <div className="cf-row-actions">
          <a className="cf-link-btn" href="https://accounts.xanom.co/" target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center" }}>Manage at accounts.xanom.co ↗</a>
          <Button size="sm" variant="secondary" disabled={busy} onClick={async () => { setBusy(true); await window.cfApi.signOut(); window.location.reload(); }}>{busy ? "Signing out…" : "Sign out of Forge"}</Button>
        </div>
      </div>
    </Panel>
  );
}

function AssistantPanel() {
  const url = window.location.origin + "/mcp";
  const [list, setList] = React.useState(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(() => window.cfApi.connections().then(setList).catch((e) => setError(e.message)), []);
  React.useEffect(() => { load(); }, [load]);
  const disconnect = async (id) => {
    setError("");
    try { await window.cfApi.connections(id); await load(); } catch (e) { setError(e.message); }
  };
  return (
    <Panel title="Connect an assistant">
      <div style={{ display: "grid", gap: 16 }}>
        <p className="cf-help" style={{ color: "var(--body)" }}>Let Grok, ChatGPT, Claude or another assistant keep your applications page current: add schools, update statuses and dates, record decisions, add follow-ups and flags, and manage share links for parents and counselors. It can’t see your portal passwords or essays, and you approve it once with your Xanom sign-in.</p>
        <CopyField value={url} label="Forge MCP server address" />
        <div className="cf-fields" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }}>
          <div>
            <h3 className="cf-subhead">Grok and Grok Bot</h3>
            <ol className="cf-steps"><li>Open grok.com/connectors.</li><li>New Connector, then Custom.</li><li>Paste the address above, leave client ID and secret empty, and allow access.</li></ol>
          </div>
          <div>
            <h3 className="cf-subhead">ChatGPT</h3>
            <ol className="cf-steps"><li>Settings, then Apps and connectors.</li><li>Create a connector with the address above.</li><li>Sign in with Xanom when asked.</li></ol>
          </div>
          <div>
            <h3 className="cf-subhead">Claude</h3>
            <ol className="cf-steps"><li>Settings, then Connectors.</li><li>Add custom connector with the address above.</li><li>Sign in with Xanom when asked.</li></ol>
          </div>
        </div>
        <div>
          <h3 className="cf-subhead">Connected</h3>
          {error ? <p role="alert" className="cf-help" style={{ color: "var(--error)" }}>{error}</p> : null}
          {list === null ? <p className="cf-help">Loading…</p> : list.length === 0 ? <p className="cf-help">No assistants connected yet.</p> : (
            <ul className="cf-apps-list">
              {list.map((c) => (
                <li key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap" }}>
                  <span><strong style={{ fontWeight: 500, color: "var(--ink)" }}>{c.name}</strong><span className="cf-help" style={{ display: "block" }}>{c.host} · connected {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></span>
                  <Button size="sm" variant="secondary" onClick={() => disconnect(c.id)}>Disconnect</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Settings({ theme, account, onToggleTheme, onStartOnboarding, onWorkspaceChange }) {
  const [status, setStatus] = React.useState(null);
  const [prefs, setPrefs] = React.useState(loadAiPrefs);
  const [busy, setBusy] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [statusError, setStatusError] = React.useState("");

  const loadStatus = React.useCallback(async () => {
    setLoading(true); setStatusError("");
    try {
      const res = await fetch("/api/ai/status", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error("Couldn’t check AI connections. Please retry.");
      const next = await res.json();
      setStatus(next);
      setStatusError(Object.values(next.connectionErrors || {}).join(" "));
    } catch (e) { setStatus(null); setStatusError(e.message || "Couldn’t check AI connections. Please retry."); }
    setLoading(false);
  }, []);

  React.useEffect(() => { loadStatus(); }, [loadStatus]);

  const updatePrefs = (patch) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      saveAiPrefs(next);
      return next;
    });
    setMsg("Preferences saved on this device.");
    setErr("");
  };

  const disconnect = async (provider) => {
    setBusy(provider); setErr(""); setMsg("");
    try {
      const res = await fetch(`/api/auth/${provider}/logout`, { method: "POST", credentials: "same-origin" });
      if (!res.ok) throw new Error("Could not disconnect.");
      setMsg(provider === "grok" ? "Grok disconnected." : "ChatGPT disconnected.");
      await loadStatus();
    } catch (e) { setErr(e.message); }
    setBusy("");
  };

  const [rebuildLog, setRebuildLog] = React.useState("");
  const setupBusy = busy === "reset" || busy === "rebuild";

  const rebuildHub = async () => {
    setErr(""); setMsg("");
    if (status && !chosenAvailable) {
      setErr("Connect an AI provider above to rebuild your hub.");
      return;
    }
    setBusy("rebuild"); setRebuildLog("Starting…");
    try {
      if (window.cfFlushEssayDrafts) await window.cfFlushEssayDrafts();
      const { ws, failed } = await window.cfRebuildHub(window.CF_DATA, setRebuildLog);
      if (typeof onWorkspaceChange === "function") onWorkspaceChange(ws);
      setMsg(failed.length
        ? `Hub rebuilt, but the AI couldn't finish ${failed.join(", ")}. Rebuild again to retry just those.`
        : "Hub rebuilt. Check Timeline for deadlines and Essays for prompts.");
    } catch (e) {
      setErr(e.message || "Could not rebuild your hub.");
    }
    setRebuildLog(""); setBusy("");
  };

  const redoOnboarding = () => {
    setErr(""); setMsg("");
    if (typeof onStartOnboarding === "function") onStartOnboarding();
  };

  const resetHubAndOnboard = async () => {
    const ok = window.confirm(
      "Reset this hub to empty and restart onboarding?\n\nThis clears profile, colleges, essays drafts, uploads metadata, and setup state. AI provider sign-ins are kept."
    );
    if (!ok) return;
    setBusy("reset"); setErr(""); setMsg("");
    try {
      if (window.cfFlushEssayDrafts) await window.cfFlushEssayDrafts();
      const res = await fetch("/api/workspace", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not reset hub.");
      const ws = j.data || j;
      if (typeof onWorkspaceChange === "function") onWorkspaceChange(ws);
      setMsg("Hub reset. Starting onboarding…");
      if (typeof onStartOnboarding === "function") onStartOnboarding({ fresh: true });
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };

  const chosenProvider = prefs.preferred !== "auto" ? prefs.preferred : status?.active;
  const providerLabel = { grok: "Grok", codex: "ChatGPT", opencode: "OpenCode" };
  const chosenAvailable = chosenProvider === "grok" ? status?.grokConnected : chosenProvider === "codex" ? status?.codexConnected : status?.opencodeAvailable;
  const activeLabel = !status ? "Unknown" : !chosenProvider ? "None" : `${providerLabel[chosenProvider]}${chosenAvailable ? "" : " · unavailable"}`;


  const preferredOptions = [
    { value: "auto", label: "Auto (use first available)" },
    { value: "grok", label: "Use Grok" },
    { value: "codex", label: "Use ChatGPT" },
  ];
  if (status && status.opencodeAvailable) {
    preferredOptions.push({ value: "opencode", label: "Use OpenCode" });
  }

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Settings</h1>
          <p className="cf-page-lede">
            Your account, assistants that can use your applications, the copilot’s AI provider, and appearance.
          </p>
        </div>
      </header>

      {statusError ? <div role="alert" className="cf-notice">{statusError} <button type="button" onClick={loadStatus} disabled={loading}>Retry connections</button></div> : null}
      {err ? <div role="alert" style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--error) 12%, transparent)", color: "var(--error)", fontSize: 13 }}>{err}</div> : null}
      {msg ? <div role="status" style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--accent-teal, #2a9d8f) 12%, transparent)", color: "var(--ink)", fontSize: 13 }}>{msg}</div> : null}

      <AccountPanel account={account} />
      <AssistantPanel />

      <Panel title="AI providers" action={
        loading ? null : (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Selected: <strong style={{ color: "var(--ink)" }}>{activeLabel}</strong>
          </span>
        )
      }>
        <p style={{ margin: "0 0 4px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
          The copilot runs on <strong style={{ color: "var(--ink)" }}>your own</strong> Grok or ChatGPT account. Connect an account to chat with the advisor. Your profile, recommendations, uploads and planning tools work without AI.
        </p>
        {!loading && status ? (
          <p style={{
            margin: "12px 0 0",
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--hairline)",
            background: status.webSearchAvailable
              ? "color-mix(in srgb, var(--accent-teal, #2a9d8f) 10%, transparent)"
              : "color-mix(in srgb, var(--warning, #d4a017) 12%, transparent)",
            fontSize: 13,
            color: "var(--body)",
            lineHeight: 1.5,
          }}>
            <strong style={{ color: "var(--ink)" }}>Web research: </strong>
            {status.webSearchAvailable
              ? "Available for checking current admissions information and college websites."
              : "Unavailable in this installation. Recommendations use the dated dataset; verify current requirements on college websites."}
          </p>
        ) : null}

        {loading ? (
          <p style={{ margin: "16px 0 0", fontSize: 13, color: "var(--muted)" }}>Checking connections…</p>
        ) : (
          <>
            <ProviderRow
              name="grok"
              label="Grok (xAI)"
              blurb="Sign in with your xAI / Grok account. Use it for college research and application planning."
              connected={!!(status && status.grokConnected)}
              models={status && status.grokModels}
              defaultModel={status && status.defaultGrokModel}
              modelValue={prefs.grokModel || (status && status.defaultGrokModel) || ""}
              onModelChange={(v) => updatePrefs({ grokModel: v })}
              onDisconnect={() => disconnect("grok")}
              busy={busy === "grok"}
              connectSlot={<ConnectFlow provider="grok" label="Grok" onDone={() => { setMsg("Grok connected."); loadStatus(); }} />}
            />
            <ProviderRow
              name="codex"
              label="ChatGPT"
              blurb="Sign in with your ChatGPT / OpenAI account. Use your existing subscription for AI guidance."
              connected={!!(status && status.codexConnected)}
              models={status && status.codexModels}
              defaultModel={status && status.defaultCodexModel}
              modelValue={prefs.codexModel || (status && status.defaultCodexModel) || ""}
              onModelChange={(v) => updatePrefs({ codexModel: v })}
              onDisconnect={() => disconnect("codex")}
              busy={busy === "codex"}
              connectSlot={<ConnectFlow provider="codex" label="ChatGPT" onDone={() => { setMsg("ChatGPT connected."); loadStatus(); }} />}
            />
            {status && status.opencodeAvailable ? (
              <ProviderRow
                name="opencode"
                label="OpenCode"
                blurb="Server-side OpenCode API key is configured. No browser sign-in required."
                connected
                models={status.opencodeModels}
                defaultModel={status.defaultOpencodeModel}
                modelValue={prefs.opencodeModel || status.defaultOpencodeModel || ""}
                onModelChange={(v) => updatePrefs({ opencodeModel: v })}
                onDisconnect={null}
                busy={false}
                connectSlot={null}
              />
            ) : null}

            <div style={{ marginTop: 8, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}>
              <Select
                label="Provider for new messages"
                value={prefs.preferred || "auto"}
                onChange={(v) => updatePrefs({ preferred: v })}
                options={preferredOptions}
                hint="A selected provider must be available; messages are never sent through a different account. Auto uses the first available: Grok → ChatGPT → OpenCode."
              />
            </div>
          </>
        )}
      </Panel>

      <Panel title="Appearance">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", marginBottom: 4 }}>Theme</div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              Choose a comfortable reading theme. Current: <strong style={{ color: "var(--ink)" }}>{theme === "dark" ? "Dark" : "Light"}</strong>
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={onToggleTheme}>
            {theme === "dark" ? "Switch to light" : "Switch to dark"}
          </Button>
        </div>
      </Panel>

      <Panel title="Setup">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", marginBottom: 4 }}>Rebuild hub</div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                Have the AI rebuild your plan from the answers you already saved. It fills in deadlines, milestones and this year's essay prompts. Your school list, edits and drafts are kept. This takes a few minutes.
              </p>
              {rebuildLog ? <p role="status" style={{ margin: "8px 0 0", fontSize: 13, color: "var(--body)" }}>{rebuildLog}</p> : null}
            </div>
            <Button size="sm" onClick={rebuildHub} disabled={setupBusy}>
              {busy === "rebuild" ? "Rebuilding…" : "Rebuild hub"}
            </Button>
          </div>
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", marginBottom: 4 }}>Redo onboarding</div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                Review your story, academics, and college preferences. Your existing answers are prefilled; finishing saves your changes.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={redoOnboarding} disabled={setupBusy}>
              Redo onboarding
            </Button>
          </div>
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", marginBottom: 4 }}>Reset hub &amp; start over</div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                Wipe workspace data to empty, then open onboarding from a clean slate. AI logins stay connected.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={resetHubAndOnboard} disabled={setupBusy}>
              {busy === "reset" ? "Resetting…" : "Reset hub"}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="About this hub">
        <SectionLabel style={{ marginBottom: 8 }}>Data & privacy</SectionLabel>
        <ul style={{ margin: "0 0 16px", paddingLeft: 18, fontSize: 13.5, color: "var(--body)", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>Your work is saved to your Xanom account. Portal passwords are encrypted and only used to check your portals.</li>
          <li>AI sign-ins stay in this browser. Only connect the account you want the copilot to use.</li>
          <li>Your model and appearance preferences are saved in this browser.</li>
        </ul>
        <SectionLabel style={{ marginBottom: 8 }}>Tips</SectionLabel>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--body)", lineHeight: 1.55 }}>
          Use <strong style={{ color: "var(--ink)" }}>Share & export</strong> for advisor links and to download drafts and an application pack.
        </p>
      </Panel>
    </div>
  );
}

window.Settings = Settings;
