const { Button } = window.CollegeForgeDesignSystem_e95e63;

/**
 * A writing coach's view of one student (lib/parent-view.ts essaysView): every essay prompt with its draft,
 * read-only, and a comment box per essay. Comments go to /api/parent/[id] and show up beside that essay in the
 * student's Essays tab.
 */

const countOf = (e, text) => (/character/i.test(e.unit) ? Array.from(text).length : text.trim() ? text.trim().split(/\s+/).length : 0);

async function postNote(id, body) {
  const res = await fetch("/api/parent/" + encodeURIComponent(id), {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.reload(); throw new Error("Please sign in again."); }
  if (!res.ok || j.success === false) throw new Error((j && j.error) || "That didn’t save. Try again.");
  return j.data;
}

function CoachEssay({ d, e, notes, onChange }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const draft = (d.essayDrafts && d.essayDrafts[e.id]) || "";
  const status = (d.essayStatus && d.essayStatus[e.id]) || (draft.trim() ? "draft" : "");
  const send = async (body, after) => {
    setBusy(true);
    setErr("");
    try { onChange(await postNote(d.id, body)); if (after) after(); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <details className="cf-parent-essay" open={notes.length > 0 || undefined}>
      <summary>
        {e.label} <span className="cf-nums">{countOf(e, draft)}/{e.limit} {e.unit}</span>
        {status ? <span className="cf-nums">{status === "final" ? "Final" : "Draft"}</span> : null}
        {notes.length ? <span className="cf-nums">{notes.length} comment{notes.length === 1 ? "" : "s"}</span> : null}
      </summary>
      <p className="cf-parent-prompt">{e.prompt}</p>
      <div className="cf-parent-draft">{draft.trim() ? draft : "No draft yet."}</div>
      {notes.map((n) => (
        <div key={n.id} style={{ marginTop: 10, padding: "8px 12px", borderLeft: "2px solid var(--hairline)", fontSize: 13, lineHeight: 1.5, color: "var(--body)" }}>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{n.body}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
            {new Date(n.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ·{" "}
            <button type="button" className="cf-link-btn" disabled={busy} onClick={() => { if (window.confirm("Delete this comment?")) send({ action: "delete-note", noteId: n.id }); }}>Delete</button>
          </div>
        </div>
      ))}
      <form onSubmit={(ev) => { ev.preventDefault(); if (text.trim()) send({ action: "note", essayId: e.id, body: text.trim() }, () => setText("")); }} style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <textarea aria-label={`Comment on ${e.label}`} rows={3} maxLength={4000} value={text} onChange={(ev) => setText(ev.target.value)} placeholder="Leave a comment for your student on this essay"
          style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: "var(--radius-sm)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)", fontSize: 14, fontFamily: "var(--font-body)" }} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button size="sm" type="submit" disabled={busy || !text.trim()}>{busy ? "Saving…" : "Post comment"}</Button>
          {err ? <span role="alert" style={{ fontSize: 13, color: "var(--error)" }}>{err}</span> : null}
        </div>
      </form>
    </details>
  );
}

function CoachEssays({ d, onChange }) {
  const name = d.student.name || "Your student";
  const groups = [
    { key: "common", title: "Common App", items: (d.essays && d.essays.commonApp) || [] },
    ...(d.schools || []).map((s) => ({ key: s.slug, title: s.name, items: (d.essays && d.essays.supplements && d.essays.supplements[s.slug]) || [] })),
  ].filter((g) => g.items.length);
  const notesFor = (id) => (d.notes || []).filter((n) => n.essayId === id);
  return (
    <React.Fragment>
      <header className="cf-share-head">
        <h1>{name}’s essays</h1>
        <p>{d.student.cycle ? `${d.student.cycle} · ` : ""}You’re {name}’s writing coach. You see their essays and drafts, read-only, and your comments show up beside each essay in {name}’s Forge.</p>
      </header>
      {groups.length ? groups.map((g) => (
        <section key={g.key} className="cf-parent-section">
          <h2>{g.title}<span className="cf-nums"> {g.items.length}</span></h2>
          {g.items.map((e) => <CoachEssay key={e.id} d={d} e={e} notes={notesFor(e.id)} onChange={onChange} />)}
        </section>
      )) : <p className="cf-parent-empty">No essays yet.</p>}
    </React.Fragment>
  );
}
window.CoachEssays = CoachEssays;
