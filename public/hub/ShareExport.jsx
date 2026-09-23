const { Button, Badge, SectionLabel } = window.CollegeForgeDesignSystem_e95e63;

function Panel({ title, children }) {
  return (
    <section style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: 24, marginBottom: 20 }}>
      <h2 className="cf-display" style={{ margin: "0 0 12px", fontSize: 22, color: "var(--ink)" }}>{title}</h2>
      {children}
    </section>
  );
}

function ShareExport({ data, onWorkspaceChange, onWorkspaceSwitch }) {
  const [busy, setBusy] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");
  const [confirmClaim, setConfirmClaim] = React.useState(false);
  const [essayId, setEssayId] = React.useState("");
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
      if (window.cfFlushEssayDrafts) await window.cfFlushEssayDrafts();
      const j = await window.cfApi.postAction("claim-recovery", { code: claimCode.trim() });
      if (!j.data) throw new Error("The workspace could not be opened. Please try again.");
      const applySwitch = onWorkspaceSwitch || onWorkspaceChange;
      if (applySwitch) applySwitch(j.data);
      else window.CF_DATA = j.data;
      try { localStorage.removeItem("cf.favorites"); } catch (_) {}
      setNewShareUrl("");
      setClaimCode("");
      setConfirmClaim(false);
      setMsg("Workspace linked. Loading your saved data…");
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

  const downloadExport = (format) => run("export-" + format, async () => {
    if (window.cfFlushEssayDrafts) await window.cfFlushEssayDrafts();
    const url = window.cfApi.exportUrl(format) + (format === "txt" && essayId ? "&essayId=" + encodeURIComponent(essayId) : "");
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Could not download the export. Please try again.");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || `college-forge.${format === "brief" ? "md" : format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    const skipped = Number(response.headers.get("x-calendar-skipped") || 0);
    const count = Number(response.headers.get("x-calendar-events") || 0);
    setMsg(format === "ics" ? `Calendar downloaded with ${count} dated event${count === 1 ? "" : "s"}.${skipped ? ` ${skipped} date${skipped === 1 ? " was" : "s were"} skipped because the date or year needs correction. Check your timeline and graduation year.` : ""}` : "Download ready. Check your browser’s downloads.");
  });

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Share & export</h1>
          <p className="cf-page-lede">
            Save your work across devices, share it with an advisor, and download drafts or deadlines for your applications.
          </p>
        </div>
      </header>

      {err ? <div role="alert" style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--error) 12%, transparent)", color: "var(--error)", fontSize: 13 }}>{err}</div> : null}
      {msg ? <div role="status" style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--accent-teal) 12%, transparent)", color: "var(--ink)", fontSize: 13 }}>{msg}</div> : null}

      <Panel title="Multi-device recovery">
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
          Your hub is tied to a browser cookie. Create a recovery code, then enter it on another phone or laptop to open the same workspace.
        </p>
        {data.recoveryCode ? (
          <div style={{ marginBottom: 12, padding: "12px 16px", background: "var(--surface-soft)", borderRadius: "var(--radius-md)", fontFamily: "var(--font-mono)", fontSize: 22, letterSpacing: "0.15em", overflowWrap: "anywhere", color: "var(--ink)" }}>
            {data.recoveryCode}
          </div>
        ) : (
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>No recovery code yet.</p>
        )}
        <Button size="sm" onClick={createRecovery} disabled={!!busy}>
          {busy === "recovery" ? "Working…" : data.recoveryCode ? "Show existing code" : "Create recovery code"}
        </Button>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}>
          <label htmlFor="workspace-recovery-code" style={{ display: "block", fontSize: 13, color: "var(--ink)", marginBottom: 8 }}>Open another workspace with a recovery code</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input id="workspace-recovery-code" autoComplete="off" spellCheck={false}
              value={claimCode}
              onChange={(e) => { setClaimCode(e.target.value.toUpperCase()); setConfirmClaim(false); }}
              placeholder="ABCD2345"
              style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", fontFamily: "var(--font-mono)", letterSpacing: "0.1em", fontSize: 14, background: "var(--canvas)", color: "var(--ink)" }}
            />
            <Button size="sm" variant="secondary" onClick={() => setConfirmClaim(true)} disabled={!!busy || claimCode.trim().length < 6}>
              Open workspace
            </Button>
          </div>
          {confirmClaim ? <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--hairline)", borderRadius: "var(--radius-sm)" }}>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--body)", lineHeight: 1.6 }}>This switches this browser to the workspace for that code. Save your current recovery code or download a backup first so you can return. Your two workspaces will not be merged.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button size="sm" onClick={claimRecovery} disabled={!!busy}>{busy === "claim" ? "Linking…" : "Switch workspace"}</Button><Button size="sm" variant="secondary" onClick={() => setConfirmClaim(false)} disabled={!!busy}>Stay here</Button></div>
          </div> : null}
        </div>
      </Panel>

      <Panel title="Advisor share links">
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
          Anyone with a share link can read your profile, school list, essay drafts, and timeline, and leave notes. Revoke a link below to end access.
        </p>
        <Button size="sm" onClick={createShare} disabled={!!busy}>
          {busy === "share" ? "Creating…" : "Create share link"}
        </Button>
        {newShareUrl ? (
          <div style={{ marginTop: 12, padding: 12, background: "var(--surface-soft)", borderRadius: "var(--radius-md)", wordBreak: "break-all", fontSize: 13 }}>
            <a href={newShareUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--coral)" }}>{newShareUrl}</a>
          </div>
        ) : null}
        {shares.length > 0 ? (
          <ul style={{ margin: "16px 0 0", padding: 0, listStyle: "none" }}>
            {shares.map((s) => (
              <li key={s.token} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid var(--hairline-soft)", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, color: "var(--ink)" }}>{s.label || "Advisor link"}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{s.token.slice(0, 12)}…</div>
                  <a href={origin + "/hub/share.html?t=" + encodeURIComponent(s.token)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--coral)" }}>Open link</a>
                </div>
                <Button size="sm" variant="secondary" onClick={() => revoke(s.token)} disabled={!!busy}>Revoke</Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Export for Common App & counselors">
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
          Download a paste-ready pack (activities ≤150 chars guidance in Profile), calendar of deadlines, or a counselor brief. Use these when filling Common App — no account linking required.
        </p>
        <label style={{ display: "block", fontSize: 13, color: "var(--ink)", marginBottom: 16 }}>Common App essay in the text pack
          <select value={essayId} onChange={(event) => setEssayId(event.target.value)} style={{ display: "block", marginTop: 6, padding: 10, width: "100%", maxWidth: 500, background: "var(--canvas)", color: "var(--ink)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-sm)" }}>
            <option value="">All Common App prompts and drafts</option>
            {(data.essays?.commonApp || []).map((essay) => <option key={essay.id} value={essay.id}>{essay.label}</option>)}
          </select>
        </label>
        <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>Choose a personal statement before copying your application. School supplements remain included. Calendar dates without a year use your graduation year’s application cycle; invalid or ambiguous dates are skipped.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {[["txt", "Common App pack (.txt)"], ["brief", "Counselor brief (.md)"], ["ics", "Deadlines calendar (.ics)"], ["json", "Full backup (.json)"]].map(([format, label]) => <Button key={format} size="sm" variant="secondary" onClick={() => downloadExport(format)} disabled={!!busy}>{busy === "export-" + format ? "Preparing…" : label}</Button>)}
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
