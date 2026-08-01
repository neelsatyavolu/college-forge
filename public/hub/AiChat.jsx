const { Button } = window.CollegeForgeDesignSystem_e95e63;

const AI_PREFS_KEY = "cf.ai";

/** True when a workspace field has real content (not blank / em dash). */
function cfChatHasValue(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return s !== "" && s !== "—";
}

/**
 * Adaptive empty-state prompts from workspace gaps (+ optional current hub view).
 * Returns up to 3 concrete, actionable suggestions ordered by priority.
 */
function cfChatAdaptiveSuggestions(ws, view) {
  const a = (ws && ws.applicant) || {};
  const p = (ws && ws.profile) || {};
  const colleges = (ws && ws.colleges) || [];
  const activities = (p.activities || []).length;
  const honors = (p.honors || []).length;
  const aps = ((p.testing && p.testing.aps) || []).length;
  const uploads = (ws && ws.uploads) || [];
  const drafts = Object.keys((ws && ws.essayDrafts) || {}).filter(
    (k) => String((ws.essayDrafts[k] || "")).trim().length > 0
  ).length;
  const recs = ((ws && ws.recommendations) || []).length;
  const scholarships = ((ws && ws.scholarships) || []).length;
  const dates = ((ws && ws.criticalDates) || []).length;
  const fa = (ws && ws.financialAid) || {};
  const faIdle =
    (!fa.fafsaStatus || fa.fafsaStatus === "not_started") &&
    (!fa.cssStatus || fa.cssStatus === "not_started" || fa.cssStatus === "n_a");
  const hasEd = Boolean(ws && ws.ed && cfChatHasValue(ws.ed.school));
  const hasGpa = cfChatHasValue(a.gpaUnweighted) || cfChatHasValue(a.gpaWeighted);
  const hasSat = cfChatHasValue(a.sat) || cfChatHasValue(p.testing && p.testing.sat);
  const hasIdentity =
    cfChatHasValue(a.name) || cfChatHasValue(p.hs) || cfChatHasValue(p.intended) || cfChatHasValue(p.location);
  const profileThin = !hasGpa && activities === 0 && honors === 0;
  const reaches = colleges.filter((c) => c.tier === "reach").length;
  const targets = colleges.filter((c) => c.tier === "target").length;
  const safeties = colleges.filter((c) => c.tier === "safety").length;
  const suppCount = Object.values((ws && ws.essays && ws.essays.supplements) || {}).reduce(
    (n, arr) => n + (arr ? arr.length : 0),
    0
  );
  const schoolNames = colleges
    .slice(0, 3)
    .map((c) => c.short || c.name)
    .filter(Boolean);
  const topSchool = schoolNames[0] || null;

  // Priority-ordered gap prompts (push order = priority; de-duped).
  const ranked = [];
  const push = (s) => {
    if (s && ranked.indexOf(s) === -1) ranked.push(s);
  };

  // 0. View-aware boosts first (student is already on that page)
  if (view === "essays") {
    if (drafts === 0) push("Help me pick a Common App prompt and draft a strong opening.");
    else if (topSchool) push(`Critique my draft for ${topSchool} and suggest stronger specifics.`);
    else push("Outline my Common App personal statement from my activities and story.");
  }
  if (view === "shortlist" && colleges.length > 0) {
    push("Review my shortlist for major fit and honest tiers.");
  }
  if (view === "explore") {
    push(
      colleges.length < 8
        ? "Suggest schools like the ones I favor that I haven't added yet."
        : "Find a few more safeties that still fit my major and location prefs."
    );
  }
  if (view === "profile") {
    if (activities === 0) push("Help me structure my activities list for Common App (10 max).");
    else if (activities < 5) push("Interview me to expand my activities with stronger impact bullets.");
    else if (honors === 0) push("Add my awards and honors — I'll list them next.");
  }
  if (view === "planner" || view === "timeline") {
    push("Build a week-by-week application plan until my first deadline.");
  }
  if (view === "track") {
    if (faIdle) push("What should I know about FAFSA and CSS Profile for my schools?");
    else if (scholarships === 0) push("Suggest scholarships that fit my profile and list.");
    else if (recs === 0) push("Who should I ask for recommendations, and when should I ask?");
  }

  // 1. Profile / uploads
  if (profileThin && uploads.length === 0) {
    push("Here's my transcript and resume — build my profile.");
  } else if (profileThin && uploads.length > 0) {
    push("Read my uploads and fill GPA, coursework, testing, and activities.");
  } else if (!hasGpa) {
    push("Set my GPA and high school from what I tell you.");
  } else if (activities === 0) {
    push("Help me structure my activities list for Common App (10 max).");
  } else if (honors === 0) {
    push("Add my awards and honors — I'll list them next.");
  } else if (!hasSat && aps === 0) {
    push("Add my SAT/ACT and AP scores to the Testing section.");
  } else if (!hasIdentity) {
    push("Fill my profile basics: name, high school, intended major, location.");
  }

  // 2. College list
  if (colleges.length === 0) {
    push("Build me a balanced college list from my profile and preferences.");
    push("Add schools I'm interested in and tier them as reach / target / safety.");
  } else {
    if (!hasEd) {
      push(
        topSchool
          ? `What's my strongest Early Decision option — is ${topSchool} realistic?`
          : "What's my strongest Early Decision option on this list?"
      );
    }
    if (reaches >= 5 && reaches > targets + safeties) {
      push("My list is too reach-heavy — rebalance with real targets and safeties.");
    } else if (targets === 0 || safeties === 0) {
      push("Find target and safety schools that fit my major and stats.");
    }
    if (colleges.some((c) => !c.tier)) {
      push("Tier every school on my list as reach, target, or safety.");
    }
  }

  // 3. Essays
  if (colleges.length > 0 && drafts === 0) {
    push("Outline my Common App personal statement from my activities and story.");
  } else if (colleges.length > 0 && suppCount === 0) {
    push(
      topSchool
        ? `Pull supplement essay prompts for ${schoolNames.slice(0, 2).join(" and ")}.`
        : "Pull supplement essay prompts for schools on my list."
    );
  } else if (drafts > 0 && topSchool) {
    push(`Critique my draft for ${topSchool} and suggest stronger specifics.`);
  }

  // 4. Track / logistics
  if (colleges.length > 0 && recs === 0) {
    push("Who should I ask for recommendations, and when should I ask?");
  }
  if (colleges.length > 0 && faIdle) {
    push("What should I know about FAFSA and CSS Profile for my schools?");
  }
  if (colleges.length > 0 && dates === 0) {
    push("Populate critical dates and deadlines from my shortlist.");
  }

  // Healthy-hub fallbacks
  push("Review my hub and tell me the three highest-leverage things to do next.");
  push("Compare my top two schools for major, fit, and admissions odds.");
  if (hasEd && ws && ws.ed && cfChatHasValue(ws.ed.school)) {
    push(`Help me strengthen my ${ws.ed.school} Early Decision application.`);
  }

  return ranked.slice(0, 3);
}

/** Short intro copy that matches how filled the hub is. */
function cfChatIntroCopy(ws) {
  const a = (ws && ws.applicant) || {};
  const p = (ws && ws.profile) || {};
  const colleges = (ws && ws.colleges) || [];
  const hasGpa = cfChatHasValue(a.gpaUnweighted) || cfChatHasValue(a.gpaWeighted);
  const activities = (p.activities || []).length;
  const drafts = Object.keys((ws && ws.essayDrafts) || {}).filter(
    (k) => String((ws.essayDrafts[k] || "")).trim().length > 0
  ).length;

  if (!hasGpa && activities === 0 && colleges.length === 0) {
    return "I build and maintain your hub. Upload a transcript, resume, or award list — or tell me your profile and target schools — and I'll fill in every page.";
  }
  if (colleges.length === 0) {
    return "Your profile is started. I can build a balanced college list, re-tier schools, or pull anything still missing into the hub.";
  }
  if (drafts === 0) {
    return `You have ${colleges.length} school${colleges.length === 1 ? "" : "s"} on the list. I can rebalance tiers, pick an ED, draft essays, or fill any empty section.`;
  }
  return "Your hub is taking shape. Ask me to refine the list, strengthen essays, set deadlines, or update anything that looks off.";
}

function loadAiPrefs() {
  try {
    const raw = localStorage.getItem(AI_PREFS_KEY);
    if (!raw) return {};
    const j = JSON.parse(raw);
    return j && typeof j === "object" ? j : {};
  } catch (e) {
    return {};
  }
}

/** Paperclip icon — stroke SVG, not emoji (emoji renders inconsistently across OS fonts). */
function AttachIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

// Minimal markdown: **bold** + paragraphs.
function renderRich(md) {
  return String(md).split("\n\n").map((para, i) => (
    <p key={i} style={{ margin: "0 0 8px" }}>
      {para.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
        seg.startsWith("**") ? <strong key={j} style={{ fontWeight: 600, color: "inherit" }}>{seg.slice(2, -2)}</strong> : <React.Fragment key={j}>{seg}</React.Fragment>
      )}
    </p>
  ));
}

function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", padding: "2px 0" }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--muted)", animation: "cfbounce 1s infinite", animationDelay: `${-0.3 + i * 0.15}s` }} />
      ))}
    </span>
  );
}

// ── Provider connect (Grok / ChatGPT-Codex OAuth) ────────────────────────
function ConnectPanel({ status, onConnected }) {
  const [flow, setFlow] = React.useState(null); // "grok" | "codex"
  const [authUrl, setAuthUrl] = React.useState("");
  const [callback, setCallback] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const start = async (provider) => {
    setErr(""); setBusy(true); setFlow(provider); setCallback("");
    try {
      const res = await fetch(`/api/auth/${provider}/start`, { method: "POST", credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not start sign-in.");
      setAuthUrl(j.authorizeUrl);
      window.open(j.authorizeUrl, "_blank", "noopener");
    } catch (e) { setErr(e.message); setFlow(null); }
    setBusy(false);
  };

  const complete = async () => {
    if (!callback.trim() || !flow) return;
    setErr(""); setBusy(true);
    try {
      const res = await fetch(`/api/auth/${flow}/complete`, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback: callback.trim() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sign-in failed.");
      setFlow(null); setAuthUrl(""); setCallback("");
      onConnected();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const btn = { width: "100%", justifyContent: "center" };

  return (
    <div style={{ borderRadius: "var(--radius-md)", background: "var(--surface-soft)", border: "1px solid var(--hairline)", padding: 14, fontSize: 13 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--ink)", fontWeight: 600, marginBottom: 8 }}>Connect an AI to power the copilot</div>
      <p style={{ margin: "0 0 10px", color: "var(--muted)", lineHeight: 1.5 }}>
        The copilot runs on <strong style={{ color: "var(--ink)" }}>your own</strong> Grok (xAI) or ChatGPT account. Nothing works until one is connected.
      </p>
      {!flow ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Button size="md" onClick={() => start("grok")} disabled={busy} style={btn}>Connect Grok</Button>
          <Button size="md" variant="secondary" onClick={() => start("codex")} disabled={busy} style={btn}>Connect ChatGPT</Button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.55 }}>
            Authorizing <strong style={{ color: "var(--ink)" }}>{flow === "grok" ? "Grok" : "ChatGPT"}</strong> in a new tab
            {authUrl ? <> (<a href={authUrl} target="_blank" rel="noopener noreferrer">reopen</a>)</> : null}:
            <ol style={{ margin: "6px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
              <li>Approve the request.</li>
              <li>
                You’ll land on a <strong style={{ color: "var(--ink)" }}>page that fails to load</strong> (localhost). That’s expected.
              </li>
              <li>Copy that page’s full URL from the address bar and paste it below.</li>
            </ol>
          </div>
          <input value={callback} onChange={(e) => setCallback(e.target.value)} placeholder="Paste the localhost URL from the address bar…"
            style={{ width: "100%", boxSizing: "border-box", borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", padding: "8px 10px", fontSize: 12.5, color: "var(--ink)", outline: "none", fontFamily: "var(--font-body)" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" onClick={complete} disabled={busy || !callback.trim()}>Finish sign-in</Button>
            <Button size="sm" variant="secondary" onClick={() => { setFlow(null); setErr(""); }} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
      {err ? <p style={{ margin: "10px 0 0", color: "var(--error)", fontSize: 12 }}>{err}</p> : null}
    </div>
  );
}

function AiChat({ open, onClose, onWorkspaceChange, onUserMessage, data, view }) {
  const [messages, setMessages] = React.useState([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [provider, setProvider] = React.useState(null); // status object
  const [attachments, setAttachments] = React.useState([]);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState("");
  const scrollRef = React.useRef(null);
  const fileRef = React.useRef(null);

  const suggestions = React.useMemo(
    () => cfChatAdaptiveSuggestions(data, view),
    [data, view]
  );
  const introCopy = React.useMemo(() => cfChatIntroCopy(data), [data]);

  // Returns the fresh status so callers can act on it without waiting for the
  // state update. cache:"no-store" so an expired session can't look connected.
  const loadStatus = React.useCallback(async () => {
    try {
      const res = await fetch("/api/ai/status", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return null;
      const j = await res.json();
      setProvider(j);
      return j;
    } catch (e) {
      return null;
    }
  }, []);

  React.useEffect(() => { if (open) loadStatus(); }, [open, loadStatus]);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, status]);

  const connected = provider && provider.active;

  const appendToLastAssistant = (text) => {
    setMessages((m) => {
      const copy = m.slice();
      const last = copy[copy.length - 1];
      if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + text };
      return copy;
    });
  };

  const uploadFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setError(""); setUploading(true);
    try {
      const fd = new FormData();
      for (const f of fileList) fd.append("files", f);
      const res = await fetch("/api/upload", { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload failed.");
      setAttachments((a) => [...a, ...(j.saved || [])]);
      if (j.errors && j.errors.length) setError(j.errors.join(" · "));
    } catch (e) { setError(e.message); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const send = async (textArg) => {
    const text = (textArg != null ? textArg : input).trim();
    if ((!text && attachments.length === 0) || busy) return;
    // Re-check with the server rather than trusting cached client state: if the
    // OAuth session expired, the composer may still look enabled.
    const fresh = await loadStatus();
    if (!fresh || !fresh.active) {
      setError("No AI is connected. Connect Grok or ChatGPT above, then send again.");
      return;
    }
    setError("");
    if (onUserMessage) onUserMessage();

    const userContent =
      text ||
      `I uploaded ${attachments.map((a) => a.name).join(", ")}. Please read them and populate my hub.`;
    const attachNote = attachments.length && text
      ? `${text}\n\n(Attached files: ${attachments.map((a) => a.name).join(", ")} — read them and update my hub.)`
      : userContent;

    const outgoing = [...messages, { role: "user", content: attachNote }];
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setInput(""); setAttachments([]); setBusy(true); setStatus("Thinking…");

    try {
      const prefs = loadAiPrefs();
      const body = { messages: outgoing };
      if (prefs.preferred && prefs.preferred !== "auto") body.provider = prefs.preferred;
      if (prefs.grokModel) body.grokModel = prefs.grokModel;
      if (prefs.codexModel) body.codexModel = prefs.codexModel;
      if (prefs.opencodeModel) body.opencodeModel = prefs.opencodeModel;

      const res = await fetch("/api/ai/chat", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        let msg = `Request failed (${res.status}).`;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
          if (!line.trim()) continue;
          let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
          if (ev.type === "delta") appendToLastAssistant(ev.text);
          else if (ev.type === "status") {
            const soft = window.cfChatStatus && window.cfChatStatus.softenStatusMessage
              ? window.cfChatStatus.softenStatusMessage(ev.message)
              : ev.message;
            setStatus(soft || "Working…");
          } else if (ev.type === "tool") {
            const label = window.cfChatStatus && window.cfChatStatus.friendlyToolMessage
              ? window.cfChatStatus.friendlyToolMessage(ev.name, ev.path)
              : "Updating your hub…";
            setStatus(label);
          }
          else if (ev.type === "error") { appendToLastAssistant(`⚠️ ${ev.message}`); }
          else if (ev.type === "done") setStatus("");
        }
      }
    } catch (e) {
      appendToLastAssistant(`⚠️ ${e.message}`);
    }
    setBusy(false); setStatus("");
    if (onWorkspaceChange) onWorkspaceChange();
    loadStatus();
  };

  if (!open) return null;

  const activeLabel = connected
    ? (provider.active === "grok" ? "Grok" : provider.active === "codex" ? "ChatGPT" : "AI")
    : "not connected";

  return (
    <div className="cf-chat-panel" style={{ position: "absolute", bottom: 16, right: 16, zIndex: 50, display: "flex", flexDirection: "column", borderRadius: "var(--radius-xl)", border: "1px solid var(--hairline)", background: "var(--canvas)", boxShadow: "var(--shadow-lg)", overflow: "hidden" }}>
      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--hairline)", background: "var(--surface-card)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span aria-hidden style={{ color: "var(--coral)", fontSize: 18, lineHeight: 1 }}>✱</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>Copilot</span>
          <span style={{ fontSize: 10.5, fontWeight: 500, color: connected ? "var(--ink)" : "var(--muted)", background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-pill)", padding: "2px 8px" }}>{activeLabel}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="cf-press"
          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--muted)", height: 40, width: 40, borderRadius: "var(--radius-sm)", fontSize: 14 }}>✕</button>
      </header>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {!connected ? <ConnectPanel status={provider} onConnected={loadStatus} /> : null}

        {messages.length === 0 && !busy ? (
          <div style={{ fontSize: 13.5, color: "var(--body)" }}>
            <p style={{ margin: "0 0 12px", lineHeight: 1.5 }}>{introCopy}</p>
            <div style={{ borderRadius: "var(--radius-md)", background: "var(--surface-soft)", border: "1px solid var(--hairline)", padding: 10 }}>
              <p style={{ margin: "0 0 6px", fontSize: 11, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--ink)", fontWeight: 600 }}>Try</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} disabled={!connected} style={{ textAlign: "left", cursor: connected ? "pointer" : "not-allowed", opacity: connected ? 1 : 0.55, border: "1px solid var(--hairline)", background: "var(--canvas)", borderRadius: "var(--radius-sm)", padding: "7px 10px", fontSize: 12.5, color: "var(--body)" }}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {messages.map((m, i) => (
          m.role === "assistant" && !m.content && busy && i === messages.length - 1 ? null : (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "85%", borderRadius: "var(--radius-lg)", padding: "8px 12px", fontSize: 13.5, lineHeight: 1.5,
              ...(m.role === "user"
                ? { background: "var(--coral)", color: "var(--on-primary)", whiteSpace: "pre-wrap" }
                : { background: "var(--surface-card)", color: "var(--ink)", border: "1px solid var(--hairline)" }) }}>
              {m.role === "user" ? m.content : renderRich(m.content)}
            </div>
          </div>
          )
        ))}

        {busy ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
            <TypingDots /> <span>{status || "Working…"}</span>
          </div>
        ) : null}
      </div>

      {/* Attachments + errors */}
      {(attachments.length > 0 || error) ? (
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--hairline)", background: "var(--surface-soft)", display: "flex", flexDirection: "column", gap: 6 }}>
          {attachments.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {attachments.map((a, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-pill)", padding: "3px 10px", color: "var(--ink)" }}>
                  <span style={{ display: "grid", placeItems: "center", color: "var(--muted)", flexShrink: 0 }}><AttachIcon size={13} /></span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>{a.name}</span>
                  <button type="button" onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))} aria-label={"Remove " + a.name}
                    style={{ border: "none", background: "none", cursor: "pointer", color: "var(--muted)", fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
                </span>
              ))}
            </div>
          ) : null}
          {error ? <div style={{ fontSize: 12, color: "var(--error)" }}>{error}</div> : null}
        </div>
      ) : null}

      {/* Composer */}
      <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ borderTop: "1px solid var(--hairline)", padding: 10, background: "var(--canvas)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <input ref={fileRef} type="file" multiple onChange={(e) => uploadFiles(e.target.files)}
            accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json,.rtf,.html,text/*" style={{ display: "none" }} />
          <button type="button" onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading || busy}
            aria-label="Attach files" title="Attach transcript, resume, files…" className="cf-press"
            style={{ flexShrink: 0, height: 40, width: 40, borderRadius: "var(--radius-md)", border: "1px solid var(--hairline)", background: "var(--canvas)", cursor: uploading || busy ? "wait" : "pointer", color: "var(--muted)", display: "grid", placeItems: "center", padding: 0, opacity: uploading || busy ? 0.55 : 1 }}>
            {uploading ? (
              <span style={{ fontSize: 14, lineHeight: 1, color: "var(--muted)" }}>…</span>
            ) : (
              <AttachIcon size={18} />
            )}
          </button>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={connected ? "Ask, or upload files to populate your hub…" : "Connect an AI above to begin…"}
            disabled={!connected}
            style={{ flex: 1, borderRadius: "var(--radius-md)", border: "1px solid var(--hairline)", background: "var(--canvas)", padding: "8px 12px", fontSize: 13.5, color: "var(--ink)", outline: "none", fontFamily: "var(--font-body)" }} />
          <Button type="submit" size="md" disabled={busy || !connected || (!input.trim() && attachments.length === 0)}>{busy ? "…" : "Send"}</Button>
        </div>
      </form>
    </div>
  );
}
window.AiChat = AiChat;
