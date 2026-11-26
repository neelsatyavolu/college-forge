const { Button, Badge, SectionLabel } = window.CollegeForgeDesignSystem_e95e63;

function Panel({ title, children }) {
  return (
    <section style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: 24, marginBottom: 20 }}>
      <h2 className="cf-display" style={{ margin: "0 0 12px", fontSize: 22, color: "var(--ink)" }}>{title}</h2>
      {children}
    </section>
  );
}

const PARENT_LEVELS = [
  ["basic", "Basic", "Applications, statuses, deadlines and decisions you’ve opened."],
  ["standard", "Standard", "Basic, plus to-dos, your college list, letters, scholarships and financial aid."],
  ["full", "Full", "Standard, plus your profile (GPA, scores, activities) and essay drafts. Read-only."],
];

async function parentsApi(body) {
  const res = await fetch("/api/parents", body ? {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : { credentials: "same-origin", cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new Error((j && j.error) || "That didn’t save. Try again.");
  return j;
}

/** Invite parents to their own read-only dashboard and choose how much each one sees (app/api/parents). */
function ParentsPanel() {
  const [parents, setParents] = React.useState(null);
  const [email, setEmail] = React.useState("");
  const [level, setLevel] = React.useState("basic");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [sent, setSent] = React.useState(null);

  React.useEffect(() => {
    parentsApi().then((j) => setParents(j.data), (e) => { setParents([]); setErr(e.message); });
  }, []);

  const act = async (body, after) => {
    setBusy(true);
    setErr("");
    try {
      const j = await parentsApi(body);
      setParents(j.data);
      if (after) await after(j);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const invite = (event) => {
    event.preventDefault();
    if (!email.trim()) return;
    act({ action: "invite", email: email.trim(), level }, async (j) => {
      let copied = false;
      try { await navigator.clipboard.writeText(j.url); copied = true; } catch (e) {}
      setSent({ url: j.url, email: email.trim(), emailed: j.emailed, copied });
      setEmail("");
    });
  };

  const fieldStyle = { padding: "9px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)", fontSize: 14 };

  return (
    <Panel title="Parents">
      <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
        Invite a parent by email. They create a Forge account with that same email, then see your applications read-only on the web or the iPhone app, at the level you choose. They never see portal logins or a decision before you open it. Change a level or remove a parent at any time.
      </p>
      <form onSubmit={invite} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--ink)", flex: "1 1 240px" }}>Parent’s email
          <input type="email" required maxLength={254} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="parent@example.com" style={fieldStyle} />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--ink)", flex: "0 1 160px" }}>They see
          <select value={level} onChange={(e) => setLevel(e.target.value)} style={fieldStyle}>
            {PARENT_LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <Button size="sm" type="submit" disabled={busy || !email.trim()} style={{ height: 40 }}>{busy ? "Sending…" : "Send invite"}</Button>
      </form>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>{PARENT_LEVELS.find(([v]) => v === level)[2]}</p>
      {err ? <p role="alert" style={{ margin: "12px 0 0", fontSize: 13, color: "var(--error)" }}>{err}</p> : null}
      {sent ? (
        <div role="status" style={{ marginTop: 12, padding: 12, background: "var(--surface-soft)", borderRadius: "var(--radius-md)", fontSize: 13, color: "var(--ink)" }}>
          {sent.emailed ? `Invite emailed to ${sent.email}.` : `The email didn’t send. Send ${sent.email} this link yourself.`}{sent.copied ? " Link copied." : ""} It works once, for 14 days.
          <div style={{ marginTop: 6, wordBreak: "break-all", fontFamily: "var(--font-mono)", fontSize: 12 }}>{sent.url}</div>
        </div>
      ) : null}
      {parents && parents.length ? (
        <ul style={{ margin: "16px 0 0", padding: 0, listStyle: "none" }}>
          {parents.map((p) => (
            <li key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid var(--hairline-soft)", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: "var(--ink)", overflowWrap: "anywhere" }}>{p.status === "active" ? (p.parentName || p.parentEmail || p.email) : p.email}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", overflowWrap: "anywhere" }}>
                  {p.status === "active"
                    ? `Following since ${new Date(p.acceptedAt).toLocaleDateString()}`
                    : p.expired ? "Invite expired" : `Invited ${new Date(p.invitedAt).toLocaleDateString()} · hasn’t accepted yet`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select aria-label={`What ${p.email} sees`} value={p.level} disabled={busy} onChange={(e) => act({ action: "set-level", id: p.id, level: e.target.value })} style={{ ...fieldStyle, padding: "6px 8px", fontSize: 13 }}>
                  {PARENT_LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {p.status === "invited" ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => act({ action: "invite", email: p.email, level: p.level }, async (j) => setSent({ url: j.url, email: p.email, emailed: j.emailed, copied: false }))}>Resend</Button> : null}
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => { if (window.confirm(p.status === "active" ? "Remove this parent? They lose access right away." : "Cancel this invite?")) act({ action: "remove", id: p.id }); }}>{p.status === "active" ? "Remove" : "Cancel"}</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
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

      <ParentsPanel />

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
