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
  const [essayId, setEssayId] = React.useState("");
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

  const createShare = (scope) =>
    run("share", async () => {
      const j = await window.cfApi.postAction("create-share", { scope, label: scope === "progress" ? "Progress link" : "Advisor link" });
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
            Share a read-only view with a counselor or parent, and download your drafts, deadlines or a full backup. Your work follows your Xanom account to any device.
          </p>
        </div>
      </header>

      {err ? <div role="alert" style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--error) 12%, transparent)", color: "var(--error)", fontSize: 13 }}>{err}</div> : null}
      {msg ? <div role="status" style={{ marginBottom: 16, padding: 12, borderRadius: "var(--radius-md)", background: "color-mix(in srgb, var(--accent-teal) 12%, transparent)", color: "var(--ink)", fontSize: 13 }}>{msg}</div> : null}

      <Panel title="Advisor share links">
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
          A progress link (for parents or a counselor) shows your applications page: schools, statuses, dates, follow-ups, flags and decisions. A full advisor link also shows your profile, school list and essay drafts. Anyone with either link can leave you notes. Neither shows portal logins or a decision you haven’t opened. Revoke a link below to end access.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="sm" onClick={() => createShare("progress")} disabled={!!busy}>
            {busy === "share" ? "Creating…" : "Create progress link"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => createShare("full")} disabled={!!busy}>Create full advisor link</Button>
        </div>
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
                  <div style={{ fontSize: 14, color: "var(--ink)" }}>{s.label || "Advisor link"} <span style={{ color: "var(--muted)", fontSize: 12 }}>· {s.scope === "progress" ? "progress only" : "full hub"}</span></div>
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
