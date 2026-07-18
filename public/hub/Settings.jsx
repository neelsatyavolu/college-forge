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
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", maxWidth: 360, boxSizing: "border-box", padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)", fontSize: 14, fontFamily: "var(--font-body)" }}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint ? <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>{hint}</div> : null}
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
        {err ? <p style={{ margin: "8px 0 0", color: "var(--error)", fontSize: 12 }}>{err}</p> : null}
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
          <li>You’ll land on a page that fails to load (localhost). That’s expected.</li>
          <li>Copy that page’s full URL and paste it below.</li>
        </ol>
      </div>
      <input value={callback} onChange={(e) => setCallback(e.target.value)}
        placeholder="Paste the localhost URL from the address bar…"
        style={{ width: "100%", boxSizing: "border-box", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", padding: "8px 10px", fontSize: 12.5, color: "var(--ink)", outline: "none", fontFamily: "var(--font-body)" }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" onClick={complete} disabled={busy || !callback.trim()}>Finish sign-in</Button>
        <Button size="sm" variant="secondary" onClick={() => { setAuthUrl(""); setErr(""); }} disabled={busy}>Cancel</Button>
      </div>
      {err ? <p style={{ margin: 0, color: "var(--error)", fontSize: 12 }}>{err}</p> : null}
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

function Settings({ theme, onToggleTheme, onStartOnboarding, onWorkspaceChange }) {
  const [status, setStatus] = React.useState(null);
  const [prefs, setPrefs] = React.useState(loadAiPrefs);
  const [busy, setBusy] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  const loadStatus = React.useCallback(async () => {
    try {
      const res = await fetch("/api/ai/status", { credentials: "same-origin", cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch (e) { /* ignore */ }
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

  const activeLabel = !status || !status.active
    ? "None"
    : status.active === "grok" ? "Grok"
      : status.active === "codex" ? "ChatGPT"
        : status.active === "opencode" ? "OpenCode"
          : status.active;

  const preferredOptions = [
    { value: "auto", label: "Auto (use first available)" },
    { value: "grok", label: "Prefer Grok" },
    { value: "codex", label: "Prefer ChatGPT" },
  ];
  if (status && status.opencodeAvailable) {
    preferredOptions.push({ value: "opencode", label: "Prefer OpenCode" });
  }

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Settings</h1>
          <p className="cf-page-lede">
            Connect AI providers for the copilot, pick models, and adjust appearance. Provider sessions stay on this browser; preferences are saved locally.
          </p>
        </div>
      </header>

      {err ? <div style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--error) 12%, transparent)", color: "var(--error)", fontSize: 13 }}>{err}</div> : null}
      {msg ? <div style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--accent-teal, #2a9d8f) 12%, transparent)", color: "var(--ink)", fontSize: 13 }}>{msg}</div> : null}

      <Panel title="AI providers" action={
        loading ? null : (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Active: <strong style={{ color: "var(--ink)" }}>{activeLabel}</strong>
          </span>
        )
      }>
        <p style={{ margin: "0 0 4px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
          The copilot runs on <strong style={{ color: "var(--ink)" }}>your own</strong> Grok or ChatGPT account. Connect at least one to chat, upload transcripts, and update your hub.
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
            <strong style={{ color: "var(--ink)" }}>Web search: </strong>
            {status.webSearchAvailable
              ? "Exa is configured — the copilot can look up admit rates, deadlines, and school facts live."
              : "Not configured. Add EXA_API_KEY on the server (Vercel env or .env.local) so the copilot can search the web. Get a key at dashboard.exa.ai."}
          </p>
        ) : null}

        {loading ? (
          <p style={{ margin: "16px 0 0", fontSize: 13, color: "var(--muted)" }}>Checking connections…</p>
        ) : (
          <>
            <ProviderRow
              name="grok"
              label="Grok (xAI)"
              blurb="Sign in with your xAI / Grok account. Best for long-context planning and hub edits."
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
              blurb="Sign in with your ChatGPT / OpenAI account (Codex OAuth). Same flow as the AiChat app."
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
                label="Preferred provider"
                value={prefs.preferred || "auto"}
                onChange={(v) => updatePrefs({ preferred: v })}
                options={preferredOptions}
                hint="When more than one is connected, the preferred provider is tried first. Auto uses Grok → ChatGPT → OpenCode."
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
              College Forge ships a designed dark theme — not a browser invert. Current: <strong style={{ color: "var(--ink)" }}>{theme === "dark" ? "Dark" : "Light"}</strong>
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
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", marginBottom: 4 }}>Redo onboarding</div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                Re-run the setup wizard (story, list prefs, AI hub build). Existing hub data is kept and used as prefill; finishing overwrites fields the wizard saves.
              </p>
            </div>
            <Button size="sm" onClick={redoOnboarding} disabled={busy === "reset"}>
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
            <Button size="sm" variant="secondary" onClick={resetHubAndOnboard} disabled={busy === "reset"}>
              {busy === "reset" ? "Resetting…" : "Reset hub"}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="About this hub">
        <SectionLabel style={{ marginBottom: 8 }}>Data & privacy</SectionLabel>
        <ul style={{ margin: "0 0 16px", paddingLeft: 18, fontSize: 13.5, color: "var(--body)", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>Your workspace is stored server-side and keyed to a browser cookie.</li>
          <li>AI provider tokens live in secure cookies on this device — we don’t store Common App passwords or session cookies.</li>
          <li>Model / provider preferences above are saved only in localStorage on this browser.</li>
        </ul>
        <SectionLabel style={{ marginBottom: 8 }}>Tips</SectionLabel>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--body)", lineHeight: 1.55 }}>
          Use <strong style={{ color: "var(--ink)" }}>Share</strong> for multi-device recovery codes and advisor links.
          Export paste-ready packs there for Common App — we never reverse-engineer Common App.
        </p>
      </Panel>
    </div>
  );
}

window.Settings = Settings;
