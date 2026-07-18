const { Badge, Button } = window.CollegeForgeDesignSystem_e95e63;

const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function buildGroups(data) {
  const groups = [{ key: "common", title: "Common App", items: data.essays.commonApp || [] }];
  Object.keys(data.essays.supplements || {}).forEach((slug) => {
    const c = (data.colleges || []).find((x) => x.slug === slug);
    groups.push({
      key: slug,
      title: c ? c.short : slug,
      subtitle: c ? c.name : null,
      items: data.essays.supplements[slug],
    });
  });
  return groups;
}

function SidebarItem({ it, active, count, onClick }) {
  const over = count > it.limit;
  const started = count > 0;
  return (
    <button type="button" onClick={onClick} className="cf-press" style={{ width: "100%", textAlign: "left", cursor: "pointer", border: "none", borderRadius: "var(--radius-sm)", padding: "10px", minHeight: 40, display: "flex", alignItems: "center", gap: 9, background: active ? "var(--surface-card)" : "transparent", transitionProperty: "background", transitionDuration: "120ms" }}>
      <span style={{ flexShrink: 0, width: 7, height: 7, borderRadius: "50%", background: over ? "var(--error)" : started ? "var(--accent-teal)" : "var(--hairline)" }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: active ? 500 : 400, color: active ? "var(--ink)" : "var(--body)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
      <span className="cf-nums" style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11, color: over ? "var(--error)" : "var(--muted-soft)" }}>{count}</span>
    </button>
  );
}

function Editor({ it, value, onChange, saveState }) {
  const count = wordCount(value);
  const over = count > it.limit;
  const underMin = it.limit >= 650 && count > 0 && count < 250;
  const pct = Math.min(100, Math.round((count / it.limit) * 100));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <div style={{ padding: "22px 28px 16px", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <Badge variant="cream" uppercase>{it.group || "Supplement"}</Badge>
          <span className="cf-nums" style={{ fontSize: 12, color: "var(--muted)" }}>Limit {it.limit} {it.unit}</span>
          {it.limit >= 650 ? (
            <span className="cf-nums" style={{ fontSize: 12, color: "var(--muted-soft)" }}>min 250</span>
          ) : null}
        </div>
        <h2 className="cf-display" style={{ margin: 0, fontSize: "clamp(18px, 2.5vw, 22px)", lineHeight: 1.3, color: "var(--ink)", textWrap: "balance" }}>{it.label}</h2>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--muted)", lineHeight: 1.5, maxWidth: 720, textWrap: "pretty" }}>{it.prompt}</p>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "20px 28px", overflowY: "auto" }}>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Start writing, or paste a draft. The copilot can outline, tighten, or fact-check any paragraph. Drafts save to your hub (all devices with your recovery code)."
          spellCheck="true"
          style={{ width: "100%", minHeight: "100%", boxSizing: "border-box", border: "none", outline: "none", resize: "none", background: "transparent", color: "var(--ink)", fontFamily: "var(--font-body)", fontSize: 16, lineHeight: 1.7 }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 28px", borderTop: "1px solid var(--hairline)", background: "var(--surface-soft)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
          <span className="cf-nums" style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: over ? "var(--error)" : "var(--ink)", fontWeight: 500 }}>{count} / {it.limit} {it.unit}</span>
          <div style={{ flex: 1, maxWidth: 220, height: 5, borderRadius: "var(--radius-pill)", background: "var(--surface-cream-strong)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: pct + "%", background: over ? "var(--error)" : pct > 85 ? "var(--accent-amber)" : "var(--accent-teal)", transition: "width 160ms ease" }} />
          </div>
          {over ? <span className="cf-nums" style={{ fontSize: 12, color: "var(--error)" }}>{count - it.limit} over</span> : null}
          {underMin ? <span className="cf-nums" style={{ fontSize: 12, color: "var(--accent-amber)" }}>under 250 min</span> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)", flexShrink: 0 }}>
          <span aria-hidden style={{ color: saveState === "saved" ? "var(--accent-teal)" : saveState === "error" ? "var(--error)" : "var(--muted-soft)" }}>
            {saveState === "saved" ? "●" : saveState === "error" ? "!" : "…"}
          </span>
          <span>
            {saveState === "saved" ? "Saved to hub" : saveState === "error" ? "Save failed" : "Saving…"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Essays({ data, onAsk, onWorkspaceChange }) {
  const groups = React.useMemo(() => buildGroups(data), [data]);
  const allItems = React.useMemo(
    () => groups.flatMap((g) => g.items.map((it) => ({ ...it, group: it.group || g.title }))),
    [groups]
  );
  const serverDrafts = data.essayDrafts || {};
  const [local, setLocal] = React.useState(() => {
    const init = {};
    allItems.forEach((it) => {
      init[it.id] = serverDrafts[it.id] != null ? serverDrafts[it.id] : (it.starter || "");
    });
    return init;
  });
  const [saveState, setSaveState] = React.useState("saved");
  const [activeId, setActiveId] = React.useState(allItems[0] ? allItems[0].id : null);
  const timer = React.useRef(null);
  const active = allItems.find((it) => it.id === activeId) || allItems[0];

  // Sync when workspace reloads from server
  React.useEffect(() => {
    setLocal((prev) => {
      const next = { ...prev };
      allItems.forEach((it) => {
        if (serverDrafts[it.id] != null && prev[it.id] !== serverDrafts[it.id]) {
          // Prefer local dirty buffer if unsaved; otherwise take server
          if (saveState === "saved") next[it.id] = serverDrafts[it.id];
        } else if (next[it.id] == null) {
          next[it.id] = serverDrafts[it.id] || it.starter || "";
        }
      });
      return next;
    });
  }, [data.essayDrafts, allItems.length]);

  const persist = (id, text) => {
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const ws = await window.cfApi.patch({ essayDraft: { id, text } });
        if (onWorkspaceChange) onWorkspaceChange(ws);
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
      }
    }, 600);
  };

  const handleChange = (id, v) => {
    setLocal((d) => ({ ...d, [id]: v }));
    setSaveState("saving");
    persist(id, v);
  };

  React.useEffect(() => () => clearTimeout(timer.current), []);

  const notes = (data.advisorNotes || []).filter((n) => n.essayId === (active && active.id));

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Essays</h1>
          <p className="cf-page-lede">
            Common App prompts (2026–27, same as prior cycle) plus school supplements. Personal statement: 250–650 words. Drafts save to your hub — not just this browser.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onAsk}>Ask copilot to draft ✱</Button>
      </header>

      {allItems.length === 0 ? (
        <div className="cf-empty">
          No essay prompts yet. Common App prompts should load automatically — refresh, or ask the copilot to set up your supplements.
        </div>
      ) : (
        <div className="cf-split" style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--canvas)", height: "min(620px, calc(100vh - 220px))" }}>
          <aside className="cf-split__list" style={{ width: 268, minWidth: 220, maxWidth: 300, borderRight: "1px solid var(--hairline)", background: "var(--surface-soft)", overflowY: "auto", padding: 12, maxHeight: "none" }}>
            {groups.map((g) => (
              <div key={g.key} style={{ marginBottom: 14 }}>
                <div style={{ padding: "4px 10px 6px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.3px", color: "var(--muted)" }}>{g.title}</span>
                  {g.key !== "common" ? <span className="cf-nums" style={{ fontSize: 10, color: "var(--muted-soft)" }}>{g.items.length}</span> : null}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {g.items.map((it) => (
                    <SidebarItem key={it.id} it={it} active={activeId === it.id} count={wordCount(local[it.id] || "")} onClick={() => setActiveId(it.id)} />
                  ))}
                </div>
              </div>
            ))}
            <div style={{ padding: "8px 10px", marginTop: 4, borderTop: "1px solid var(--hairline)", fontSize: 11.5, color: "var(--muted-soft)" }}>
              Drafts sync to your workspace
            </div>
          </aside>

          <div className="cf-split__detail" style={{ border: "none", borderRadius: 0, display: "flex", flexDirection: "column" }}>
            {active ? (
              <Editor key={active.id} it={active} value={local[active.id] || ""} onChange={(v) => handleChange(active.id, v)} saveState={saveState} />
            ) : null}
            {notes.length > 0 ? (
              <div style={{ borderTop: "1px solid var(--hairline)", padding: "12px 28px", background: "var(--surface-soft)", maxHeight: 120, overflowY: "auto" }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", marginBottom: 8 }}>Advisor notes on this essay</div>
                {notes.map((n) => (
                  <p key={n.id} style={{ margin: "0 0 8px", fontSize: 13, color: "var(--body)", lineHeight: 1.45 }}>
                    <strong>{n.author}</strong>: {n.body}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
window.Essays = Essays;
