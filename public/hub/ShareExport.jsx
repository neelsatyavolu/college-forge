const { Button, Badge, SectionLabel } = window.CollegeForgeDesignSystem_e95e63;

function Panel({ title, children }) {
  return (
    <section style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: 24, marginBottom: 20 }}>
      <h2 className="cf-display" style={{ margin: "0 0 12px", fontSize: 22, color: "var(--ink)" }}>{title}</h2>
      {children}
    </section>
  );
}

function ShareExport({ data, onWorkspaceChange }) {
  const [busy, setBusy] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");
  const [claimCode, setClaimCode] = React.useState("");
  const [newShareUrl, setNewShareUrl] = React.useState("");
  const shares = (data.shares || []).filter((s) => !s.revokedAt);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const run = async (label, fn) => {
    setBusy(label);
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message || "Something went wrong");
    }
    setBusy("");
  };

  const createRecovery = () =>
    run("recovery", async () => {
      const j = await window.cfApi.postAction("create-recovery");
      if (onWorkspaceChange && j.data) onWorkspaceChange(j.data);
      setMsg("Recovery code ready — save it somewhere safe. It links this hub across devices.");
    });

  const claimRecovery = () =>
    run("claim", async () => {
      const j = await window.cfApi.postAction("claim-recovery", { code: claimCode.trim() });
      if (onWorkspaceChange && j.data) onWorkspaceChange(j.data);
      setMsg("This browser is now linked to that hub. Refresh if anything looks stale.");
      window.location.reload();
    });

  const createShare = () =>
    run("share", async () => {
      const j = await window.cfApi.postAction("create-share", { label: "Advisor link" });
      if (onWorkspaceChange && j.data) onWorkspaceChange(j.data);
      const url = origin + "/hub/share.html?t=" + encodeURIComponent(j.token);
      setNewShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setMsg("Share link created and copied to clipboard.");
      } catch {
        setMsg("Share link created — copy it below.");
      }
    });

  const revoke = (token) =>
    run("revoke", async () => {
      const j = await window.cfApi.postAction("revoke-share", { token });
      if (onWorkspaceChange && j.data) onWorkspaceChange(j.data);
      setMsg("Share link revoked.");
      if (newShareUrl.includes(token)) setNewShareUrl("");
    });

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Share & export</h1>
          <p className="cf-page-lede">
            Multi-device recovery, read-only advisor links, and exports for Common App paste / calendar / counselor brief.
            We do <strong>not</strong> connect to Common App accounts (no cookies or unofficial APIs) — export and paste is the safe path.
          </p>
        </div>
      </header>

      {err ? <div style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--error) 12%, transparent)", color: "var(--error)", fontSize: 13 }}>{err}</div> : null}
      {msg ? <div style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--accent-teal) 12%, transparent)", color: "var(--ink)", fontSize: 13 }}>{msg}</div> : null}

      <Panel title="Multi-device recovery">
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
          Your hub is tied to a browser cookie. Create a recovery code, then enter it on another phone or laptop to open the same workspace.
        </p>
        {data.recoveryCode ? (
          <div style={{ marginBottom: 12, padding: "12px 16px", background: "var(--surface-soft)", borderRadius: "var(--radius-md)", fontFamily: "var(--font-mono)", fontSize: 22, letterSpacing: "0.15em", color: "var(--ink)" }}>
            {data.recoveryCode}
          </div>
        ) : (
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>No recovery code yet.</p>
        )}
        <Button size="sm" onClick={createRecovery} disabled={!!busy}>
          {busy === "recovery" ? "Working…" : data.recoveryCode ? "Refresh / re-show code" : "Create recovery code"}
        </Button>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}>
          <SectionLabel style={{ marginBottom: 8 }}>Claim a code on this device</SectionLabel>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={claimCode}
              onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
              placeholder="ABCD2345"
              style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", fontFamily: "var(--font-mono)", letterSpacing: "0.1em", fontSize: 14, background: "var(--canvas)", color: "var(--ink)" }}
            />
            <Button size="sm" variant="secondary" onClick={claimRecovery} disabled={!!busy || claimCode.length < 6}>
              {busy === "claim" ? "Linking…" : "Link this device"}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Advisor share links">
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
          Read-only view of your profile, list, essays, and timeline. Advisors can leave notes — they cannot edit your data.
        </p>
        <Button size="sm" onClick={createShare} disabled={!!busy}>
          {busy === "share" ? "Creating…" : "Create share link"}
        </Button>
        {newShareUrl ? (
          <div style={{ marginTop: 12, padding: 12, background: "var(--surface-soft)", borderRadius: "var(--radius-md)", wordBreak: "break-all", fontSize: 13 }}>
            <a href={newShareUrl} style={{ color: "var(--coral)" }}>{newShareUrl}</a>
          </div>
        ) : null}
        {shares.length > 0 ? (
          <ul style={{ margin: "16px 0 0", padding: 0, listStyle: "none" }}>
            {shares.map((s) => (
              <li key={s.token} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid var(--hairline-soft)", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, color: "var(--ink)" }}>{s.label || "Advisor link"}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{s.token.slice(0, 12)}…</div>
                  <a href={origin + "/hub/share.html?t=" + encodeURIComponent(s.token)} style={{ fontSize: 12, color: "var(--coral)" }}>Open link</a>
                </div>
                <Button size="sm" variant="secondary" onClick={() => revoke(s.token)} disabled={!!busy}>Revoke</Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Export for Common App & counselors">
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
          Download a paste-ready pack (activities ≤150 chars guidance in Profile), calendar of deadlines, or a one-page counselor brief. Use these when filling Common App — no account linking required.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <a href={window.cfApi.exportUrl("txt")} download>
            <Button size="sm" variant="secondary">Common App pack (.txt)</Button>
          </a>
          <a href={window.cfApi.exportUrl("brief")} download>
            <Button size="sm" variant="secondary">Counselor brief (.md)</Button>
          </a>
          <a href={window.cfApi.exportUrl("ics")} download>
            <Button size="sm" variant="secondary">Deadlines calendar (.ics)</Button>
          </a>
          <a href={window.cfApi.exportUrl("json")} download>
            <Button size="sm" variant="secondary">Full backup (.json)</Button>
          </a>
        </div>
      </Panel>

      {(data.advisorNotes || []).length > 0 ? (
        <Panel title={`Advisor notes (${data.advisorNotes.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.advisorNotes.map((n) => (
              <div key={n.id} style={{ padding: "12px 14px", border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  <strong style={{ color: "var(--ink)" }}>{n.author}</strong>
                  {" · "}
                  {new Date(n.createdAt).toLocaleString()}
                  {n.essayId ? ` · essay ${n.essayId}` : ""}
                </div>
                <p style={{ margin: 0, fontSize: 14, color: "var(--body)", lineHeight: 1.5 }}>{n.body}</p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
window.ShareExport = ShareExport;
