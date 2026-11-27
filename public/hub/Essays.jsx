const { Badge, Button } = window.CollegeForgeDesignSystem_e95e63;

const UC_APPLICATION_SLUG = "uc-application";
const ESSAY_PLAN = window.cfEssayArchetypes;

const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const daysUntil = (iso, today) => Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
const shortDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const collegeName = (c) => (c && (c.short || c.name)) || "";
const SOON_DAYS = 14;
const URGENT_DAYS = 7;

/** The chat message for one essay. The copilot reads the draft itself with get_essay. */
function essayAsk(it, kind) {
  const where = `My ${it.group || "Common App"} essay "${it.label}" (id ${it.id}, limit ${it.limit} ${it.unit}). Prompt: ${it.prompt}`;
  const asks = {
    help: "Read my draft with get_essay, then help me with it.",
    outline: "Read my draft with get_essay and help me outline this essay. Ask me about my own experiences before suggesting content, and don't make any up.",
    tighten: `Read my draft with get_essay and cut it to ${it.limit} ${it.unit} or fewer without changing my voice or story. Save the shorter version with suggest_essay_edit so I can compare.`,
    check: "Read my draft with get_essay and tell me whether it answers every part of the prompt. Quote the sentences that do, and name anything it leaves out.",
  };
  return `${where} ${asks[kind]}`;
}

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

const isUcCampus = ESSAY_PLAN.isUcCampus;

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
      colleges: colleges.filter((c) => !isUcCampus(c)),
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
      colleges: ucs,
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
      colleges: [c],
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

  return sortByDeadline(groups, todayIso());
}

/**
 * Common App first, then schools by their next application deadline for the chosen
 * round, then schools with no known deadline, then schools no longer on the list.
 */
function sortByDeadline(groups, today) {
  const withDue = groups.map((g) => ({ ...g, due: g.kind === "orphan" ? null : ESSAY_PLAN.nextDeadline(g.colleges || [], today) }));
  const order = (g) => (g.kind === "orphan" ? "~" : g.due ? g.due.date : "9999");
  const [common, ...rest] = withDue;
  const sorted = rest
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (order(a.g) < order(b.g) ? -1 : order(a.g) > order(b.g) ? 1 : a.i - b.i))
    .map((x) => x.g);
  return [common, ...sorted];
}

function dueLabel(group) {
  if (!group.due) return "";
  const who = group.kind === "school" ? "" : ` · ${collegeName(group.due.college)}`;
  return `Due ${shortDate(group.due.date)} · ${group.due.round}${who}`;
}

function DueChip({ days }) {
  const urgent = days < URGENT_DAYS;
  return (
    <span
      className="cf-nums"
      style={{
        flexShrink: 0,
        fontSize: 10.5,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: "var(--radius-pill)",
        background: urgent ? "var(--error)" : "var(--accent-amber)",
        color: urgent ? "var(--on-primary)" : "var(--ink)",
      }}
    >
      {days <= 0 ? "due today" : `${days}d left`}
    </span>
  );
}

/** Essays left, words left and the next deadline, above the editor. */
function WritingSummary({ totals, next, today }) {
  const cell = { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 };
  const label = { fontSize: 11, color: "var(--muted)" };
  const value = { fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--ink)", fontWeight: 500 };
  const days = next ? daysUntil(next.date, today) : null;
  return (
    <section
      aria-label="Writing progress"
      className="cf-essay-summary"
      style={{ display: "flex", flexWrap: "wrap", gap: "10px 28px", padding: "10px 0 12px", marginBottom: 14, borderBottom: "1px solid var(--hairline)" }}
    >
      <div style={cell}>
        <span style={label}>Essays drafted</span>
        <span className="cf-nums" style={value}>{totals.drafted} of {totals.required}</span>
      </div>
      <div style={cell}>
        <span style={label}>Marked final</span>
        <span className="cf-nums" style={value}>{totals.final} of {totals.required}</span>
      </div>
      <div style={cell}>
        <span style={label}>Words written</span>
        <span className="cf-nums" style={value}>{totals.wordsWritten.toLocaleString()} of {totals.wordsRequired.toLocaleString()}</span>
      </div>
      <div style={cell}>
        <span style={label}>Next deadline</span>
        <span className="cf-nums" style={value}>
          {next ? `${shortDate(next.date)} · ${collegeName(next.college)} ${next.round}` : "None saved"}
          {next ? <span style={{ fontSize: 12, color: days < SOON_DAYS ? "var(--error)" : "var(--muted)", fontWeight: 400 }}>{` (${days <= 0 ? "today" : days + (days === 1 ? " day" : " days")})`}</span> : null}
        </span>
      </div>
    </section>
  );
}

function SidebarItem({ it, active, count, onClick, label, final }) {
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
          background: over ? "var(--error)" : final ? "var(--ink)" : started ? "var(--accent-teal)" : "var(--hairline)",
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
        {label || it.label}
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

function GroupHeader({ group, open, onToggle, startedCount, totalCount, unfinished, today }) {
  const days = group.due ? daysUntil(group.due.date, today) : null;
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
        {group.due ? (
          <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
            <span className="cf-nums" style={{ fontSize: 11, color: "var(--body)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {dueLabel(group)}
            </span>
            {unfinished && days < SOON_DAYS ? <DueChip days={days} /> : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function SuggestionPanel({ suggestion, unit, onUse, onDismiss, busy }) {
  const count = /character/i.test(unit) ? Array.from(suggestion.text).length : wordCount(suggestion.text);
  return (
    <div style={{ marginBottom: 16, padding: "12px 14px", border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)", background: "var(--surface-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <strong style={{ fontSize: 13, color: "var(--ink)" }}>
          Copilot suggestion <span className="cf-nums" style={{ fontWeight: 400, color: "var(--muted)" }}>· {count} {unit}</span>
        </strong>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" disabled={busy} onClick={onUse}>Replace my draft</Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={onDismiss}>Dismiss</Button>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--body)", whiteSpace: "pre-wrap", maxHeight: 180, overflowY: "auto" }}>{suggestion.text}</p>
    </div>
  );
}

function Editor({ it, value, onChange, saveState, schoolLabel, onAsk, status, onSetStatus, statusBusy, statusError, startFrom, suggestion, onUseSuggestion, onDismissSuggestion, hidden, onToggleHidden, aiCheck }) {
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
          {hidden ? <Badge variant="cream">Hidden</Badge> : null}
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
        {onAsk ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            <Button variant="secondary" size="sm" onClick={() => onAsk(essayAsk(it, "outline"))}>Outline</Button>
            <Button variant="secondary" size="sm" onClick={() => onAsk(essayAsk(it, "tighten"))}>Tighten to limit</Button>
            <Button variant="secondary" size="sm" onClick={() => onAsk(essayAsk(it, "check"))}>Check against prompt</Button>
          </div>
        ) : null}
      </div>

      <div className="cf-essay-writing-area" style={{ flex: 1, minHeight: 0, padding: "20px 28px", overflowY: "auto" }}>
        {aiCheck}
        {suggestion ? (
          <SuggestionPanel suggestion={suggestion} unit={it.unit} busy={statusBusy} onUse={onUseSuggestion} onDismiss={onDismissSuggestion} />
        ) : null}
        {!value.trim() && startFrom && startFrom.length ? (
          <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
            Start from
            <select
              aria-label="Start from another draft"
              value=""
              onChange={(e) => {
                const source = startFrom.find((x) => x.id === e.target.value);
                if (source) onChange(source.text);
              }}
              style={{ padding: "6px 8px", maxWidth: "100%", minWidth: 0, border: "1px solid var(--hairline)", borderRadius: "var(--radius-sm)", background: "var(--canvas)", color: "var(--ink)" }}
            >
              <option value="">a copy of another draft…</option>
              {startFrom.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        ) : null}
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
          {onSetStatus ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginRight: 10 }}>
              {statusError ? <span role="alert" style={{ color: "var(--error)" }}>{statusError}</span> : null}
              {onToggleHidden ? (
                <Button variant="secondary" size="sm" disabled={statusBusy} onClick={onToggleHidden}
                  title={hidden ? "Show this essay again and count it" : "Hide an essay you won't write. Its draft is kept."}>
                  {hidden ? "Show essay" : "Hide essay"}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                disabled={statusBusy || (status !== "final" && !value.trim())}
                onClick={() => onSetStatus(status === "final" ? "draft" : "final")}
              >
                {status === "final" ? "Final · Undo" : "Mark final"}
              </Button>
            </span>
          ) : null}
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

/** The Common App group's prompt choice: pick one of the personal essay prompts, or change it later. */
function CommonAppChoice({ choices, chosen, busy, onChoose }) {
  if (chosen) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 10px", fontSize: 12, color: "var(--muted)" }}>
        <span>Your prompt is chosen</span>
        <button type="button" className="cf-press" disabled={busy} onClick={() => onChoose(null)}
          style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", color: "var(--ink)", fontSize: 12, textDecoration: "underline" }}>
          Change prompt
        </button>
      </div>
    );
  }
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 10px 8px", fontSize: 12, color: "var(--muted)" }}>
      Choose your prompt
      <select aria-label="Choose your Common App prompt" value="" disabled={busy} onChange={(e) => e.target.value && onChoose(e.target.value)}
        style={{ padding: "6px 8px", maxWidth: "100%", minWidth: 0, border: "1px solid var(--hairline)", borderRadius: "var(--radius-sm)", background: "var(--canvas)", color: "var(--ink)", fontSize: 12.5 }}>
        <option value="">Pick one of {choices.length}…</option>
        {choices.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
      </select>
    </label>
  );
}

/** Essays the student hid, collapsed at the bottom of their group. Opening one lets them show it again. */
function HiddenRow({ items, open, onToggle, activeId, local, onSelect }) {
  return (
    <div style={{ marginTop: 4 }}>
      <button type="button" className="cf-press" aria-expanded={open} onClick={onToggle}
        style={{ border: "none", background: "transparent", cursor: "pointer", padding: "6px 10px", fontSize: 12, color: "var(--muted-soft)", textAlign: "left", width: "100%" }}>
        <span className="cf-nums">{open ? "▾" : "▸"} Hidden ({items.length})</span>
      </button>
      {open ? items.map((it) => (
        <SidebarItem key={it.id} it={it} active={activeId === it.id} count={essayCount(it, local[it.id] || "")} onClick={() => onSelect(it)} />
      )) : null}
    </div>
  );
}

function Essays({ data, onAsk, onWorkspaceChange }) {
  // Schools the student isn't writing for leave the sidebar and every count; NotWritingFor lists them.
  const allGroups = React.useMemo(() => buildGroups(data), [data]);
  const groups = React.useMemo(
    () => allGroups.filter((g) => g.kind === "orphan" || !ESSAY_PLAN.isSchoolSkipped(g.key, { essaySchools: data.essaySchools })),
    [allGroups, data.essaySchools]
  );
  const [picking, setPicking] = React.useState(false);
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
  const [activeId, setActiveId] = React.useState(() => {
    const first = ESSAY_PLAN.visibleItems(allItems, { hidden: data.essayHidden || {}, commonAppPrompt: data.commonAppPrompt || "" })[0] || allItems[0];
    return first ? first.id : null;
  });
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

  const status = data.essayStatus || {};
  const suggestions = data.essaySuggestions || {};
  const hiddenMap = React.useMemo(() => data.essayHidden || {}, [data.essayHidden]);
  const commonAppPrompt = data.commonAppPrompt || "";
  const visOpts = React.useMemo(() => ({ hidden: hiddenMap, commonAppPrompt, essaySchools: data.essaySchools }), [hiddenMap, commonAppPrompt, data.essaySchools]);
  const visibleItems = React.useMemo(() => ESSAY_PLAN.visibleItems(allItems, visOpts), [allItems, visOpts]);
  const [openHidden, setOpenHidden] = React.useState(() => new Set());
  const today = todayIso();
  const [sideMode, setSideMode] = React.useState("school");
  const [statusBusy, setStatusBusy] = React.useState(false);
  const [statusError, setStatusError] = React.useState("");
  React.useEffect(() => setStatusError(""), [activeId]);
  const totals = React.useMemo(() => ESSAY_PLAN.writingTotals(groups, local, status, visOpts), [groups, local, status, visOpts]);
  const unfinished = (g) => {
    const t = ESSAY_PLAN.writingTotals([g], local, status, visOpts);
    return t.required > t.final;
  };
  const dueGroups = groups.filter((g) => g.due);
  const nextGroup = dueGroups.filter(unfinished).sort((a, b) => (a.due.date < b.due.date ? -1 : 1))[0]
    || dueGroups.slice().sort((a, b) => (a.due.date < b.due.date ? -1 : 1))[0];
  const typeSections = React.useMemo(() => ESSAY_PLAN.byPromptType(visibleItems), [visibleItems]);
  // Other drafts this one could start from: the same kind of prompt first.
  const startFrom = React.useMemo(() => {
    if (!active) return [];
    const kind = ESSAY_PLAN.archetypeOf(active);
    return allItems
      .filter((it) => it.id !== active.id && (local[it.id] || "").trim())
      .map((it) => ({ id: it.id, text: local[it.id], same: ESSAY_PLAN.archetypeOf(it) === kind, label: `${it.group} · ${it.label} (${essayCount(it, local[it.id])} ${it.unit})` }))
      .sort((a, b) => (a.same === b.same ? 0 : a.same ? -1 : 1));
  }, [active, allItems, local]);

  const patchEssay = async (patch) => {
    setStatusBusy(true);
    setStatusError("");
    try {
      const ws = await window.cfApi.patch(patch);
      if (onWorkspaceChange) onWorkspaceChange(ws);
    } catch (e) {
      setStatusError(e.message || "Couldn’t save. Try again.");
    } finally {
      setStatusBusy(false);
    }
  };
  const setStatus = (id, next) => patchEssay({ essayStatus: { [id]: next } });
  const setHidden = (id, hide) => patchEssay({ essayHidden: { [id]: hide ? true : null } });
  const chooseCommonApp = async (id) => {
    await patchEssay({ commonAppPrompt: id || null });
    if (id) setActiveId(id);
  };
  const commonChoices = (data.essays && data.essays.commonApp || []).filter((it) => /^ca-ps-/.test(it.id) || it.chooseGroup === "common");
  const dismissSuggestion = (id) => patchEssay({ essaySuggestions: { [id]: null } });
  const acceptSuggestion = (id) => {
    handleChange(id, suggestions[id].text);
    dismissSuggestion(id);
  };

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
          <Button variant="secondary" size="sm" onClick={() => onAsk(active ? essayAsk(active, "help") : undefined)}>Ask copilot ✱</Button>
          {(data.colleges || []).length ? <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>Pick essay schools</Button> : null}
          <Button size="sm" onClick={()=>{setPromptError("");setPromptForm({groupKey:active ? active._groupKey : "common",label:"",prompt:"",limit:250,unit:"words"});}}>Add prompt</Button>
          {active ? <Button variant="secondary" size="sm" onClick={()=>{setPromptError("");setPromptForm({...active,groupKey:active._groupKey});}}>Edit prompt</Button> : null}
        </div>
      </header>

      {picking ? <window.EssaySchoolsSheet data={data} onWorkspaceChange={onWorkspaceChange} onClose={() => setPicking(false)} /> : null}
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
          No essay prompts yet. Common App prompts load automatically. Add schools on the List or Applications tab
          and each one gets its supplement group here; then ask the copilot to load the real prompts.
        </div>
      ) : (
        <React.Fragment>
        <WritingSummary totals={totals} next={nextGroup ? nextGroup.due : null} today={today} />
        <window.NotWritingFor data={data} onOpen={() => setPicking(true)} />
        {commonChoices.length > 1 ? (
          <div className="cf-mobile-essay-picker">
            <CommonAppChoice choices={commonChoices} chosen={commonAppPrompt} busy={statusBusy} onChoose={chooseCommonApp} />
          </div>
        ) : null}
        <label className="cf-mobile-essay-picker">Choose an essay
          <select aria-label="Choose an essay" value={activeId || ""} onChange={(event) => {
            const item = allItems.find(essay => essay.id === event.target.value);
            if (item) selectEssay(item, item._groupKey);
          }}>
            {groups.map(group => ({ group, items: ESSAY_PLAN.visibleItems(group.items, visOpts) })).filter(x => x.items.length).map(({ group, items }) => <optgroup key={group.key} label={group.title}>
              {items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </optgroup>)}
            {allItems.some(item => hiddenMap[item.id]) ? <optgroup label="Hidden">
              {allItems.filter(item => hiddenMap[item.id]).map(item => <option key={item.id} value={item.id}>{item.group} · {item.label}</option>)}
            </optgroup> : null}
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
            <div role="group" aria-label="Sort essays" style={{ display: "flex", gap: 2, padding: 2, margin: "0 2px 10px", borderRadius: "var(--radius-sm)", background: "var(--surface-cream-strong)" }}>
              {[["school", "By school"], ["type", "By prompt type"]].map(([mode, text]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={sideMode === mode}
                  onClick={() => setSideMode(mode)}
                  className="cf-press"
                  style={{ flex: 1, border: "none", cursor: "pointer", padding: "5px 6px", fontSize: 12, borderRadius: "var(--radius-sm)", background: sideMode === mode ? "var(--canvas)" : "transparent", color: sideMode === mode ? "var(--ink)" : "var(--muted)", fontWeight: sideMode === mode ? 500 : 400 }}
                >
                  {text}
                </button>
              ))}
            </div>
            {sideMode === "type" ? typeSections.map((section) => (
              <div key={section.id} style={{ marginBottom: 10 }}>
                <div style={{ padding: "6px 8px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
                  <span>{section.label}</span>
                  <span className="cf-nums" style={{ fontSize: 10, color: "var(--muted-soft)", fontWeight: 400 }}>{section.items.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "0 2px 0 8px" }}>
                  {section.items.map((it) => (
                    <SidebarItem
                      key={it.id}
                      it={it}
                      label={`${it.group} · ${it.label}`}
                      active={activeId === it.id}
                      final={status[it.id] === "final"}
                      count={essayCount(it, local[it.id] || "")}
                      onClick={() => selectEssay(it, it._groupKey)}
                    />
                  ))}
                </div>
              </div>
            )) : groups.map((g) => {
              const open = openKeys.has(g.key);
              const items = ESSAY_PLAN.visibleItems(g.items, visOpts);
              const hiddenItems = (g.items || []).filter((it) => hiddenMap[it.id]);
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
                    unfinished={unfinished(g)}
                    today={today}
                  />
                  {open ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "0 2px 6px 8px" }}>
                      {g.kind === "common" && commonChoices.length > 1 ? (
                        <CommonAppChoice choices={commonChoices} chosen={commonAppPrompt} busy={statusBusy} onChoose={chooseCommonApp} />
                      ) : null}
                      {ESSAY_PLAN.pickSets(g.items).map((set) => (
                        <window.PickSetControl key={set.group} set={set} hidden={hiddenMap} busy={statusBusy}
                          onSave={(patch) => patchEssay({ essayHidden: patch })} />
                      ))}
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
                            final={status[it.id] === "final"}
                            count={essayCount(it, local[it.id] || "")}
                            onClick={() => selectEssay(it, g.key)}
                          />
                        ))
                      )}
                      {hiddenItems.length ? (
                        <HiddenRow
                          items={hiddenItems}
                          open={openHidden.has(g.key)}
                          onToggle={() => setOpenHidden((prev) => { const next = new Set(prev); if (next.has(g.key)) next.delete(g.key); else next.add(g.key); return next; })}
                          activeId={activeId}
                          local={local}
                          onSelect={(it) => selectEssay(it, g.key)}
                        />
                      ) : null}
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
                onAsk={onAsk}
                status={status[active.id]}
                onSetStatus={(next) => setStatus(active.id, next)}
                statusBusy={statusBusy}
                statusError={statusError}
                startFrom={startFrom}
                suggestion={suggestions[active.id]}
                onUseSuggestion={() => acceptSuggestion(active.id)}
                onDismissSuggestion={() => dismissSuggestion(active.id)}
                hidden={!!hiddenMap[active.id]}
                onToggleHidden={() => setHidden(active.id, !hiddenMap[active.id])}
                aiCheck={window.AiCheckPanel ? (
                  <window.AiCheckPanel
                    essayId={active.id}
                    words={wordCount(local[active.id] || "")}
                    check={(data.essayAiChecks || {})[active.id]}
                    pending={saveState !== "saved"}
                    onFlush={flush}
                    onWorkspaceChange={onWorkspaceChange}
                  />
                ) : null}
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
                    <strong>{n.via === "coach" ? `Coach · ${n.author}` : n.author}</strong>: {n.body}
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
