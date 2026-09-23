const { Badge, Button } = window.CollegeForgeDesignSystem_e95e63;

const UC_APPLICATION_SLUG = "uc-application";

const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const essayCount = (it, text) => /character/i.test(it.unit) ? Array.from(text).length : wordCount(text);

// This queue outlives page navigation. The namespace is random public metadata,
// never the HttpOnly workspace cookie or a recovery credential.
const essayQueues = new Map();
function getEssayQueue(key) {
  if (key && essayQueues.has(key)) return essayQueues.get(key);
  const queue = { key, drafts: {}, timer: null, inFlight: false, error: "", storageError: false, listeners: new Set(), onSaved: null };
  if (key) {
    try {
      const stored = JSON.parse(localStorage.getItem("cf.essay-recovery." + key) || "{}");
      for (const [id, text] of Object.entries(stored)) if (typeof text === "string") queue.drafts[id] = text;
    } catch (_) { queue.storageError = true; }
    essayQueues.set(key, queue);
  }
  return queue;
}
function journalEssayQueue(queue) {
  if (!queue.key) { queue.storageError = true; return; }
  try {
    const key = "cf.essay-recovery." + queue.key;
    if (Object.keys(queue.drafts).length) localStorage.setItem(key, JSON.stringify(queue.drafts));
    else localStorage.removeItem(key);
    queue.storageError = false;
  } catch (_) { queue.storageError = true; }
}
function notifyEssayQueue(queue) { queue.listeners.forEach((notify) => notify()); }
async function flushEssayQueue(queue) {
  if (queue.key && window.CF_DATA && window.CF_DATA.draftStorageKey !== queue.key) return;
  clearTimeout(queue.timer);
  if (queue.inFlight || !Object.keys(queue.drafts).length) return;
  const drafts = {...queue.drafts};
  queue.inFlight = true;
  queue.error = "";
  notifyEssayQueue(queue);
  try {
    const ws = await window.cfApi.patch({essayDrafts:drafts});
    Object.entries(drafts).forEach(([id,text]) => {
      if (queue.drafts[id] === text) delete queue.drafts[id];
    });
    journalEssayQueue(queue);
    // A recovery-code switch must never receive an older workspace's response.
    if (queue.onSaved && (!window.CF_DATA || window.CF_DATA.draftStorageKey === queue.key)) queue.onSaved(ws);
    queue.inFlight = false;
    if (Object.keys(queue.drafts).length) return flushEssayQueue(queue);
  } catch (error) {
    queue.inFlight = false;
    queue.error = error.message || "Save failed";
  }
  notifyEssayQueue(queue);
}
// Exports and workspace switching must wait for the current draft queue.
window.cfFlushEssayDrafts = async () => {
  const key = window.CF_DATA && window.CF_DATA.draftStorageKey;
  if (!key) return;
  const queue = getEssayQueue(key);
  await new Promise((resolve, reject) => {
    const settle = () => {
      if (queue.inFlight) return;
      if (window.CF_DATA.draftStorageKey !== key) {
        queue.listeners.delete(settle);
        reject(new Error("Your workspace changed. Please try again."));
      } else if (queue.error) {
        queue.listeners.delete(settle);
        reject(new Error(queue.error));
      } else if (!Object.keys(queue.drafts).length) {
        queue.listeners.delete(settle);
        resolve();
      }
    };
    queue.listeners.add(settle);
    flushEssayQueue(queue).then(settle, (error) => {
      queue.listeners.delete(settle);
      reject(error);
    });
  });
};
window.addEventListener("beforeunload", (event) => {
  if ([...essayQueues.values()].some((queue) => Object.keys(queue.drafts).length)) {
    event.preventDefault();
    event.returnValue = "";
  }
});

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
  const count = essayCount(it, value);
  const over = count > it.limit;
  const underMin = /^ca-ps-/.test(it.id) && count > 0 && count < 250;
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
          {/^ca-ps-/.test(it.id) ? (
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

      <div className="cf-essay-writing-area" style={{ flex: 1, minHeight: 0, padding: "20px 28px", overflowY: "auto" }}>
        <textarea
          className="cf-essay-textarea"
          aria-label={it.label + " draft"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Start writing, or paste a draft. The copilot can outline, tighten, or fact-check any paragraph. Drafts save to your hub (all devices with your recovery code)."
          spellCheck="true"
          style={{
            width: "100%",
            minHeight: "100%",
            boxSizing: "border-box",
            border: "none",
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
  const queue = React.useMemo(() => getEssayQueue(data.draftStorageKey), [data.draftStorageKey]);
  const [, redrawQueue] = React.useState(0);
  const saveState = queue.error ? "error" : Object.keys(queue.drafts).length ? "saving" : "saved";
  const [local, setLocal] = React.useState(() => {
    const init = {};
    allItems.forEach((it) => {
      init[it.id] = queue.drafts[it.id] != null ? queue.drafts[it.id] : serverDrafts[it.id] != null ? serverDrafts[it.id] : it.starter || "";
    });
    return init;
  });
  const [promptForm, setPromptForm] = React.useState(null);
  const [promptSaving, setPromptSaving] = React.useState(false);
  const [promptError, setPromptError] = React.useState("");
  const [activeId, setActiveId] = React.useState(allItems[0] ? allItems[0].id : null);
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
    setLocal(() => Object.fromEntries(allItems.map((it) => [it.id, queue.drafts[it.id] ?? serverDrafts[it.id] ?? it.starter ?? ""])));
    if (activeId && !allItems.some((it) => it.id === activeId) && allItems[0]) {
      setActiveId(allItems[0].id);
    }
  }, [data.essayDrafts, allItems, queue]);

  const flush = () => flushEssayQueue(queue);
  const handleChange = (id, text) => {
    setLocal((drafts) => ({...drafts,[id]:text}));
    queue.drafts[id] = text;
    queue.error = "";
    journalEssayQueue(queue);
    notifyEssayQueue(queue);
    clearTimeout(queue.timer);
    queue.timer = setTimeout(flush, 600);
  };
  React.useEffect(() => {
    const notify = () => redrawQueue((version) => version + 1);
    queue.listeners.add(notify);
    queue.onSaved = onWorkspaceChange;
    if (Object.keys(queue.drafts).length) flushEssayQueue(queue);
    return () => {
      queue.listeners.delete(notify);
      flushEssayQueue(queue);
    };
  }, [queue, onWorkspaceChange]);

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

  const savePrompt = async (event) => {
    event.preventDefault();
    if (!promptForm.label.trim() || !promptForm.prompt.trim()) return;
    const group = groups.find((g) => g.key === promptForm.groupKey);
    if (!group) return;
    const item = { id: promptForm.id || "custom-" + crypto.randomUUID(), label: promptForm.label.trim(), prompt: promptForm.prompt.trim(), limit: Number(promptForm.limit), unit: promptForm.unit };
    const items = promptForm.id ? group.items.map((it) => it.id === item.id ? {...it,...item} : it) : [...group.items,item];
    setPromptSaving(true);
    setPromptError("");
    try {
      const essays = group.key === "common" ? {commonApp:items} : {supplements:{[group.key]:items}};
      const ws = await window.cfApi.patch({essays});
      if (onWorkspaceChange) onWorkspaceChange(ws);
      setActiveId(item.id);
      setOpenKeys((prev)=>new Set([...prev,group.key]));
      setPromptForm(null);
    } catch(e) { setPromptError(e.message || "Could not save the prompt. Please try again."); }
    finally { setPromptSaving(false); }
  };

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Essays</h1>
          <p className="cf-page-lede">
            Common App and school supplements, organized by university. Check each prompt against the current application before writing.
            Personal statement: 250–650 words. Drafts save to your hub — not just this browser.
          </p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Button variant="secondary" size="sm" onClick={onAsk}>Ask copilot to draft ✱</Button>
          <Button size="sm" onClick={()=>{setPromptError("");setPromptForm({groupKey:active ? active._groupKey : "common",label:"",prompt:"",limit:250,unit:"words"});}}>Add prompt</Button>
          {active ? <Button variant="secondary" size="sm" onClick={()=>{setPromptError("");setPromptForm({...active,groupKey:active._groupKey});}}>Edit prompt</Button> : null}
        </div>
      </header>

      {promptForm ? (
        <form onSubmit={savePrompt} style={{padding:20,border:"1px solid var(--hairline)",borderRadius:"var(--radius-md)",display:"grid",gap:12,marginBottom:20}}>
          <h2 className="cf-display" style={{margin:0,fontSize:20}}>{promptForm.id ? "Edit essay prompt" : "Add essay prompt"}</h2>
          <p style={{margin:0,color:"var(--muted)",fontSize:13}}>Copy the exact prompt and limit from the current application. Editing a prompt keeps your draft.</p>
          <label>Application<select aria-label="Prompt application" disabled={!!promptForm.id} value={promptForm.groupKey} onChange={(e)=>setPromptForm({...promptForm,groupKey:e.target.value})} style={{display:"block",padding:10,width:"100%"}}>{groups.map((g)=><option key={g.key} value={g.key}>{g.title}</option>)}</select></label>
          <label>Title<input aria-label="Prompt title" required maxLength={160} value={promptForm.label} onChange={(e)=>setPromptForm({...promptForm,label:e.target.value})} style={{display:"block",width:"100%",padding:10,boxSizing:"border-box"}} /></label>
          <label>Prompt<textarea aria-label="Essay prompt" required rows={3} value={promptForm.prompt} onChange={(e)=>setPromptForm({...promptForm,prompt:e.target.value})} style={{display:"block",width:"100%",padding:10,boxSizing:"border-box"}} /></label>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            <label>Limit<input aria-label="Prompt limit" type="number" min="1" max="50000" required value={promptForm.limit} onChange={(e)=>setPromptForm({...promptForm,limit:e.target.value})} style={{display:"block",padding:10,width:110}} /></label>
            <label>Count<select aria-label="Prompt count unit" value={promptForm.unit} onChange={(e)=>setPromptForm({...promptForm,unit:e.target.value})} style={{display:"block",padding:10}}><option value="words">Words</option><option value="characters">Characters</option></select></label>
          </div>
          {promptError ? <p role="alert" style={{color:"var(--error)"}}>{promptError}</p> : null}
          <div style={{display:"flex",gap:8}}><Button type="submit" disabled={promptSaving}>{promptSaving ? "Saving…" : "Save prompt"}</Button><Button variant="secondary" disabled={promptSaving} onClick={()=>setPromptForm(null)}>Cancel</Button></div>
        </form>
      ) : null}
      {queue.storageError && saveState !== "error" && Object.keys(queue.drafts).length ? <p role="alert" style={{color:"var(--error)"}}>Browser draft recovery is unavailable. Keep this tab open until your draft saves, or copy it before leaving.</p> : null}
      {saveState === "error" ? (
        <div role="alert" style={{ marginBottom: 16, padding: 16, border: "1px solid var(--error)", borderRadius: "var(--radius-md)", color: "var(--error)" }}>
          Your latest changes haven’t saved to the hub. {queue.storageError ? "Browser recovery is unavailable; keep this tab open or copy your draft." : "A recovery copy is kept in this browser."}
          <Button variant="secondary" size="sm" onClick={flush}>Retry saving</Button>
        </div>
      ) : null}
      {allItems.length === 0 && schoolCount === 0 ? (
        <div className="cf-empty">
          No essay prompts yet. Common App prompts should load automatically — refresh, or add schools to your list so
          supplement tabs open, then ask the copilot to load real prompts.
        </div>
      ) : (
        <React.Fragment>
        <label className="cf-mobile-essay-picker">Choose an essay
          <select aria-label="Choose an essay" value={activeId || ""} onChange={(event) => {
            const item = allItems.find(essay => essay.id === event.target.value);
            if (item) selectEssay(item, item._groupKey);
          }}>
            {groups.filter(group => group.items.length).map(group => <optgroup key={group.key} label={group.title}>
              {group.items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </optgroup>)}
          </select>
        </label>
        <div
          className="cf-split cf-split--essays"
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
                          No prompts yet. Use Add prompt to paste one from this school’s application.
                        </div>
                      ) : (
                        items.map((it) => (
                          <SidebarItem
                            key={it.id}
                            it={it}
                            active={activeId === it.id}
                            count={essayCount(it, local[it.id] || "")}
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
        </React.Fragment>
      )}
    </div>
  );
}
window.Essays = Essays;
