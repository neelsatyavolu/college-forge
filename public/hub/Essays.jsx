const { Badge, Button } = window.CollegeForgeDesignSystem_e95e63;

const UC_APPLICATION_SLUG = "uc-application";

const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function isUcCampus(c) {
  if (!c) return false;
  const slug = (c.slug || "").toLowerCase();
  const name = `${c.name || ""} ${c.short || ""}`.toLowerCase();
  if (slug.startsWith("university-of-california-")) return true;
  if (slug === "ucla" || slug === "ucb" || slug === "ucsd" || slug === "uc-berkeley") return true;
  if (/\buniversity of california\b/.test(name)) return true;
  if (/\buc\s+(berkeley|los angeles|san diego|davis|irvine|santa barbara|santa cruz|riverside|merced)\b/.test(name)) {
    return true;
  }
  if (name.trim() === "ucla") return true;
  return false;
}

/**
 * Build sidebar groups:
 *  1. Common App (always)
 *  2. UC Application (if any UC campus on the list) — shared PIQs
 *  3. One collapsible group per non-UC school on the shortlist
 *  4. Orphan supplement keys (schools removed from list but still have prompts)
 */
function buildGroups(data) {
  const colleges = data.colleges || [];
  const supplements = (data.essays && data.essays.supplements) || {};
  const groups = [
    {
      key: "common",
      title: "Common App",
      subtitle: "Personal statement — pick one",
      kind: "common",
      items: (data.essays && data.essays.commonApp) || [],
    },
  ];

  const ucs = colleges.filter(isUcCampus);
  const nonUc = colleges.filter((c) => !isUcCampus(c));
  const listedSlugs = new Set(colleges.map((c) => c.slug).filter(Boolean));

  if (ucs.length > 0) {
    const items = supplements[UC_APPLICATION_SLUG] || [];
    groups.push({
      key: UC_APPLICATION_SLUG,
      title: "UC Application",
      subtitle: ucs.map((c) => c.short || c.name).join(" · "),
      kind: "uc",
      items,
      placeholder: items.length === 0,
    });
  }

  nonUc.forEach((c) => {
    const slug = c.slug;
    if (!slug) return;
    const items = supplements[slug] || [];
    groups.push({
      key: slug,
      title: c.short || c.name || slug,
      subtitle: c.name && c.short && c.name !== c.short ? c.name : null,
      kind: "school",
      college: c,
      items,
      placeholder: items.length === 0,
    });
  });

  // Supplements for schools no longer on the list (keep drafts discoverable)
  Object.keys(supplements).forEach((slug) => {
    if (slug === UC_APPLICATION_SLUG) {
      if (ucs.length === 0 && (supplements[slug] || []).length > 0) {
        groups.push({
          key: slug,
          title: "UC Application",
          subtitle: "Not on your list",
          kind: "orphan",
          items: supplements[slug],
        });
      }
      return;
    }
    if (listedSlugs.has(slug)) return;
    // Skip orphan UC campus keys if we already have the shared group
    const maybeCollege = { slug, name: slug };
    if (isUcCampus(maybeCollege) && ucs.length > 0) return;
    const items = supplements[slug] || [];
    if (!items.length) return;
    groups.push({
      key: slug,
      title: slug.replace(/-/g, " "),
      subtitle: "Removed from list",
      kind: "orphan",
      items,
    });
  });

  return groups;
}

function SidebarItem({ it, active, count, onClick }) {
  const over = count > it.limit;
  const started = count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="cf-press"
      style={{
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        border: "none",
        borderRadius: "var(--radius-sm)",
        padding: "8px 10px",
        minHeight: 36,
        display: "flex",
        alignItems: "center",
        gap: 9,
        background: active ? "var(--surface-card)" : "transparent",
        transitionProperty: "background",
        transitionDuration: "120ms",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: over ? "var(--error)" : started ? "var(--accent-teal)" : "var(--hairline)",
        }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          fontWeight: active ? 500 : 400,
          color: active ? "var(--ink)" : "var(--body)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {it.label}
      </span>
      <span
        className="cf-nums"
        style={{
          flexShrink: 0,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: over ? "var(--error)" : "var(--muted-soft)",
        }}
      >
        {count}
      </span>
    </button>
  );
}

function GroupHeader({ group, open, onToggle, startedCount, totalCount }) {
  const chevron = open ? "▾" : "▸";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="cf-press"
      style={{
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        border: "none",
        background: "transparent",
        padding: "6px 8px",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        minHeight: 32,
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 14,
          fontSize: 11,
          color: "var(--muted)",
          lineHeight: "16px",
          marginTop: 1,
          fontFamily: "var(--font-mono)",
        }}
      >
        {chevron}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "1.2px",
              color: group.kind === "orphan" ? "var(--muted-soft)" : "var(--muted)",
            }}
          >
            {group.title}
          </span>
          <span className="cf-nums" style={{ fontSize: 10, color: "var(--muted-soft)", flexShrink: 0 }}>
            {totalCount > 0 ? `${startedCount}/${totalCount}` : "0"}
          </span>
        </span>
        {group.subtitle ? (
          <span
            style={{
              display: "block",
              fontSize: 11,
              color: "var(--muted-soft)",
              lineHeight: 1.35,
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {group.subtitle}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function Editor({ it, value, onChange, saveState, schoolLabel }) {
  const count = wordCount(value);
  const over = count > it.limit;
  const underMin = it.limit >= 650 && count > 0 && count < 250;
  const pct = Math.min(100, Math.round((count / it.limit) * 100));
  const badge = schoolLabel || it.group || "Supplement";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <div style={{ padding: "22px 28px 16px", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <Badge variant="cream" uppercase>
            {badge}
          </Badge>
          <span className="cf-nums" style={{ fontSize: 12, color: "var(--muted)" }}>
            Limit {it.limit} {it.unit}
          </span>
          {it.limit >= 650 ? (
            <span className="cf-nums" style={{ fontSize: 12, color: "var(--muted-soft)" }}>
              min 250
            </span>
          ) : null}
        </div>
        <h2
          className="cf-display"
          style={{
            margin: 0,
            fontSize: "clamp(18px, 2.5vw, 22px)",
            lineHeight: 1.3,
            color: "var(--ink)",
            textWrap: "balance",
          }}
        >
          {it.label}
        </h2>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 14,
            color: "var(--muted)",
            lineHeight: 1.5,
            maxWidth: 720,
            textWrap: "pretty",
          }}
        >
          {it.prompt}
        </p>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "20px 28px", overflowY: "auto" }}>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Start writing, or paste a draft. The copilot can outline, tighten, or fact-check any paragraph. Drafts save to your hub (all devices with your recovery code)."
          spellCheck="true"
          style={{
            width: "100%",
            minHeight: "100%",
            boxSizing: "border-box",
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            color: "var(--ink)",
            fontFamily: "var(--font-body)",
            fontSize: 16,
            lineHeight: 1.7,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 28px",
          borderTop: "1px solid var(--hairline)",
          background: "var(--surface-soft)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
          <span
            className="cf-nums"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: over ? "var(--error)" : "var(--ink)",
              fontWeight: 500,
            }}
          >
            {count} / {it.limit} {it.unit}
          </span>
          <div
            style={{
              flex: 1,
              maxWidth: 220,
              height: 5,
              borderRadius: "var(--radius-pill)",
              background: "var(--surface-cream-strong)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: pct + "%",
                background: over ? "var(--error)" : pct > 85 ? "var(--accent-amber)" : "var(--accent-teal)",
                transition: "width 160ms ease",
              }}
            />
          </div>
          {over ? (
            <span className="cf-nums" style={{ fontSize: 12, color: "var(--error)" }}>
              {count - it.limit} over
            </span>
          ) : null}
          {underMin ? (
            <span className="cf-nums" style={{ fontSize: 12, color: "var(--accent-amber)" }}>
              under 250 min
            </span>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            color: "var(--muted)",
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              color:
                saveState === "saved"
                  ? "var(--accent-teal)"
                  : saveState === "error"
                    ? "var(--error)"
                    : "var(--muted-soft)",
            }}
          >
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
    () =>
      groups.flatMap((g) =>
        (g.items || []).map((it) => ({
          ...it,
          group: it.group || g.title,
          _groupKey: g.key,
        }))
      ),
    [groups]
  );
  const serverDrafts = data.essayDrafts || {};
  const [local, setLocal] = React.useState(() => {
    const init = {};
    allItems.forEach((it) => {
      init[it.id] = serverDrafts[it.id] != null ? serverDrafts[it.id] : it.starter || "";
    });
    return init;
  });
  const [saveState, setSaveState] = React.useState("saved");
  const [activeId, setActiveId] = React.useState(allItems[0] ? allItems[0].id : null);
  const timer = React.useRef(null);
  const active = allItems.find((it) => it.id === activeId) || allItems[0];

  // Collapsed university sections — default: Common App open, schools with drafts open, first school open
  const [openKeys, setOpenKeys] = React.useState(() => {
    const open = new Set(["common"]);
    groups.forEach((g, i) => {
      if (g.key === "common") return;
      const hasDraft = (g.items || []).some((it) => wordCount(serverDrafts[it.id] || it.starter || "") > 0);
      if (hasDraft || i === 1) open.add(g.key);
    });
    return open;
  });

  // When groups change (list update), keep prior open state and auto-open new school keys once
  const prevGroupKeys = React.useRef(groups.map((g) => g.key).join("|"));
  React.useEffect(() => {
    const sig = groups.map((g) => g.key).join("|");
    if (sig === prevGroupKeys.current) return;
    prevGroupKeys.current = sig;
    setOpenKeys((prev) => {
      const next = new Set(prev);
      next.add("common");
      groups.forEach((g) => {
        if (!prev.has(g.key) && g.kind === "school") next.add(g.key);
      });
      return next;
    });
  }, [groups]);

  const toggleGroup = (key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Sync when workspace reloads from server
  React.useEffect(() => {
    setLocal((prev) => {
      const next = { ...prev };
      allItems.forEach((it) => {
        if (serverDrafts[it.id] != null && prev[it.id] !== serverDrafts[it.id]) {
          if (saveState === "saved") next[it.id] = serverDrafts[it.id];
        } else if (next[it.id] == null) {
          next[it.id] = serverDrafts[it.id] || it.starter || "";
        }
      });
      return next;
    });
    if (activeId && !allItems.some((it) => it.id === activeId) && allItems[0]) {
      setActiveId(allItems[0].id);
    }
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
  const schoolCount = groups.filter((g) => g.kind === "school" || g.kind === "uc").length;

  const selectEssay = (it, groupKey) => {
    setActiveId(it.id);
    setOpenKeys((prev) => {
      if (prev.has(groupKey)) return prev;
      const next = new Set(prev);
      next.add(groupKey);
      return next;
    });
  };

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Essays</h1>
          <p className="cf-page-lede">
            Common App prompts (2026–27) plus school supplements grouped by university. Expand a school to see its essays.
            Personal statement: 250–650 words. Drafts save to your hub — not just this browser.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onAsk}>
          Ask copilot to draft ✱
        </Button>
      </header>

      {allItems.length === 0 && schoolCount === 0 ? (
        <div className="cf-empty">
          No essay prompts yet. Common App prompts should load automatically — refresh, or add schools to your list so
          supplement tabs open, then ask the copilot to load real prompts.
        </div>
      ) : (
        <div
          className="cf-split"
          style={{
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
            background: "var(--canvas)",
            height: "min(620px, calc(100vh - 220px))",
          }}
        >
          <aside
            className="cf-split__list"
            style={{
              width: 280,
              minWidth: 230,
              maxWidth: 320,
              borderRight: "1px solid var(--hairline)",
              background: "var(--surface-soft)",
              overflowY: "auto",
              padding: "10px 8px",
              maxHeight: "none",
            }}
          >
            {groups.map((g) => {
              const open = openKeys.has(g.key);
              const items = g.items || [];
              const startedCount = items.filter((it) => wordCount(local[it.id] || "") > 0).length;
              return (
                <div
                  key={g.key}
                  style={{
                    marginBottom: 6,
                    borderRadius: "var(--radius-md)",
                    background: open ? "color-mix(in srgb, var(--surface-card) 55%, transparent)" : "transparent",
                  }}
                >
                  <GroupHeader
                    group={g}
                    open={open}
                    onToggle={() => toggleGroup(g.key)}
                    startedCount={startedCount}
                    totalCount={items.length}
                  />
                  {open ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "0 2px 6px 8px" }}>
                      {items.length === 0 ? (
                        <div
                          style={{
                            padding: "8px 10px",
                            fontSize: 12,
                            color: "var(--muted-soft)",
                            lineHeight: 1.4,
                          }}
                        >
                          No prompts yet. Ask the copilot to load supplements for this school.
                        </div>
                      ) : (
                        items.map((it) => (
                          <SidebarItem
                            key={it.id}
                            it={it}
                            active={activeId === it.id}
                            count={wordCount(local[it.id] || "")}
                            onClick={() => selectEssay(it, g.key)}
                          />
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div
              style={{
                padding: "8px 10px",
                marginTop: 4,
                borderTop: "1px solid var(--hairline)",
                fontSize: 11.5,
                color: "var(--muted-soft)",
                lineHeight: 1.4,
              }}
            >
              {schoolCount > 0
                ? `${schoolCount} school group${schoolCount === 1 ? "" : "s"} · click a university to expand`
                : "Drafts sync to your workspace"}
            </div>
          </aside>

          <div
            className="cf-split__detail"
            style={{ border: "none", borderRadius: 0, display: "flex", flexDirection: "column" }}
          >
            {active ? (
              <Editor
                key={active.id}
                it={active}
                value={local[active.id] || ""}
                onChange={(v) => handleChange(active.id, v)}
                saveState={saveState}
                schoolLabel={active.group}
              />
            ) : (
              <div className="cf-empty" style={{ border: "none", margin: "auto" }}>
                Select an essay from a university group on the left.
              </div>
            )}
            {notes.length > 0 ? (
              <div
                style={{
                  borderTop: "1px solid var(--hairline)",
                  padding: "12px 28px",
                  background: "var(--surface-soft)",
                  maxHeight: 120,
                  overflowY: "auto",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "1.2px",
                    color: "var(--muted)",
                    marginBottom: 8,
                  }}
                >
                  Advisor notes on this essay
                </div>
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
