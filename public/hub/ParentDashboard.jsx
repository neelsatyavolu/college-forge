const { Badge, Button } = window.CollegeForgeDesignSystem_e95e63;

/**
 * The parent and counselor dashboard, cut on the server to the level each student chose (lib/parent-view.ts).
 * With more than one student it opens on a roster sorted by who needs a look first (lib/follower-summary.ts),
 * then one student at a time. Parents only read; counselors can also leave notes. Opens instead of the hub
 * for someone with no applications of their own, or with ?view=parent. Someone who also applies can start
 * their own workspace from the footer.
 */

/** Per account, so another parent signing in on this browser still lands on their dashboard. */
const ownKey = (me) => "cf.ownWorkspace." + ((me && me.user && me.user.email) || "");

window.cfWantsParentDashboard = (me) => {
  const students = (me && me.parent && me.parent.students) || 0;
  if (!students) return false;
  if (new URLSearchParams(window.location.search).get("view") === "parent") return true;
  let own = false;
  try { own = localStorage.getItem(ownKey(me)) === "1"; } catch (e) {}
  return !!me.parent.home && !own;
};

const STATUS_WORDS = {
  not_started: "Not started", in_progress: "In progress", submitted: "Submitted", processed: "Processed", n_a: "Not needed",
  not_asked: "Not asked", asked: "Asked", waived: "Waived", researching: "Researching", won: "Won", lost: "Not awarded", skipped: "Skipped",
};
const word = (s) => STATUS_WORDS[s] || s || "—";

async function getJson(url, body) {
  const res = await fetch(url, body
    ? { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : { credentials: "same-origin", cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.reload(); throw new Error("Please sign in again."); }
  if (!res.ok || j.success === false) throw new Error((j && j.error) || "Couldn't load this. Try again.");
  return j.data;
}

function ParentSection({ title, count, children }) {
  return (
    <section className="cf-parent-section">
      <h2>{title}{count != null ? <span className="cf-nums"> {count}</span> : null}</h2>
      {children}
    </section>
  );
}

function deadlinesOf(d) {
  const rows = [
    ...(d.criticalDates || []).map((x) => ({ date: x.date, title: x.label, detail: x.detail })),
    ...(d.progress.apps || []).filter((a) => a.deadline && !a.submittedAt).map((a) => ({ date: a.deadline, title: `${a.name}${a.round ? ` · ${a.round}` : ""}` })),
    ...(d.scholarships || []).filter((s) => s.deadline).map((s) => ({ date: s.deadline, title: `Scholarship: ${s.name}` })),
    ...(d.recommendations || []).filter((r) => r.deadline).map((r) => ({ date: r.deadline, title: `Letter: ${r.name}` })),
  ];
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

const firstOf = (name) => (name || "Your student").trim().split(/\s+/)[0];

/** Whole days from today (local) to a yyyy-mm-dd date. */
function daysUntil(date) {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = String(date).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - today) / 864e5);
}
const inDays = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n < 0 ? `${-n}d late` : `in ${n}d`);

const SORTS = [
  ["attention", "Needs a look first"],
  ["next", "Next deadline"],
  ["name", "Name"],
];

function sortStudents(list, by) {
  const copy = [...list];
  const name = (a, b) => a.name.localeCompare(b.name);
  const next = (s) => (s.summary.next ? s.summary.next.date : "9999");
  if (by === "name") return copy.sort(name);
  if (by === "next") return copy.sort((a, b) => next(a).localeCompare(next(b)) || name(a, b));
  return copy.sort((a, b) => b.summary.attention - a.summary.attention || next(a).localeCompare(next(b)) || name(a, b));
}

/** Every student at a glance: what's late, what's due in the next two weeks, open flags, then the rest. */
function Roster({ students, onOpen }) {
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState("attention");
  const q = query.trim().toLowerCase();
  const shown = sortStudents(students.filter((s) => !q || s.name.toLowerCase().includes(q)), sort);
  const upcoming = students
    .flatMap((s) => s.summary.upcoming.map((u) => ({ ...u, id: s.id, who: firstOf(s.name) })))
    .sort((a, b) => a.date.localeCompare(b.date));
  const late = students.reduce((n, s) => n + s.summary.overdue, 0);
  return (
    <React.Fragment>
      <header className="cf-share-head">
        <h1>Your students</h1>
        <p>
          <span className="cf-nums">{students.length}</span> students
          {late ? <React.Fragment> · <strong className="cf-nums">{late}</strong> past-due application{late === 1 ? "" : "s"}</React.Fragment> : null}
          {upcoming.length ? <React.Fragment> · <span className="cf-nums">{upcoming.length}</span> date{upcoming.length === 1 ? "" : "s"} in the next two weeks</React.Fragment> : null}.
        </p>
      </header>

      {upcoming.length ? (
        <ParentSection title="Next two weeks" count={upcoming.length}>
          <ul className="cf-parent-rows">
            {upcoming.slice(0, 12).map((u, i) => (
              <li key={i}>
                <span className="cf-nums cf-parent-date">{u.date}</span>
                <span className="cf-upcoming-what"><button type="button" className="cf-link-btn cf-roster-who" onClick={() => onOpen(u.id)}>{u.who}</button> {u.title}</span>
                <span className="cf-parent-meta cf-nums cf-upcoming-when">{inDays(daysUntil(u.date))}</span>
              </li>
            ))}
          </ul>
          {upcoming.length > 12 ? <p className="cf-parent-empty">And {upcoming.length - 12} more. Open a student to see them all.</p> : null}
        </ParentSection>
      ) : null}

      <ParentSection title="Students" count={shown.length === students.length ? null : `${shown.length} of ${students.length}`}>
        <div className="cf-roster-tools">
          {students.length > 5 ? <input type="search" aria-label="Find a student" placeholder="Find a student" value={query} onChange={(e) => setQuery(e.target.value)} /> : null}
          <label>Sort <select value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        {shown.length ? (
          <ul className="cf-roster">
            {shown.map((s) => {
              const m = s.summary;
              const next = m.next ? daysUntil(m.next.date) : null;
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => onOpen(s.id)}>
                    <span className="cf-roster-name"><strong>{s.name}</strong><small>{[s.cycle, s.role === "counselor" ? "Counselor" : "Parent", s.levelLabel].filter(Boolean).join(" · ")}</small></span>
                    <span className="cf-roster-next">{m.next ? <React.Fragment><span className="cf-nums">{inDays(next)}</span><small>{m.next.title}</small></React.Fragment> : <small>No upcoming dates</small>}</span>
                    <span className="cf-roster-counts cf-nums">{m.submitted}/{m.applications} sent{m.decisions ? ` · ${m.decisions} decided` : ""}</span>
                    <span className="cf-roster-tags">
                      {m.overdue ? <Badge variant="coral">{m.overdue} late</Badge> : null}
                      {m.dueSoon ? <Badge variant="cream">{m.dueSoon} due soon</Badge> : null}
                      {m.flags ? <Badge variant="cream">{m.flags} flag{m.flags === 1 ? "" : "s"}</Badge> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="cf-parent-empty">No student matches “{query}”.</p>}
      </ParentSection>
    </React.Fragment>
  );
}

/** Counselors: leave the student a note, in general or on an essay they can see; delete their own. */
function CounselorNotes({ d, essays, onSaved }) {
  const [text, setText] = React.useState("");
  const [essayId, setEssayId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const name = firstOf(d.student.name);
  const send = async (body) => {
    setBusy(true);
    setErr("");
    try { onSaved(await getJson("/api/parent/" + encodeURIComponent(d.id), body)); return true; } catch (e) { setErr(e.message); return false; } finally { setBusy(false); }
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await send({ action: "note", body: text.trim(), essayId: essayId || undefined })) { setText(""); setEssayId(""); }
  };
  const essayName = (id) => { const e = essays.find((x) => x.id === id); return e ? `${e.group ? `${e.group} · ` : ""}${e.label}` : ""; };
  return (
    <ParentSection title="Notes" count={d.notes.length || null}>
      <form onSubmit={submit} className="cf-note-form">
        <label className="cf-sr-only" htmlFor="cf-note-text">Note for {name}</label>
        <textarea id="cf-note-text" rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder={`A note for ${name}. They see it in Forge.`} />
        <div className="cf-note-row">
          {essays.length ? (
            <select aria-label="About" value={essayId} onChange={(e) => setEssayId(e.target.value)}>
              <option value="">General note</option>
              {essays.map((x) => <option key={x.id} value={x.id}>{essayName(x.id)}</option>)}
            </select>
          ) : <span />}
          <Button size="sm" type="submit" disabled={busy || !text.trim()}>{busy ? "Saving…" : "Leave note"}</Button>
        </div>
        {err ? <p role="alert" className="cf-parent-error">{err}</p> : null}
      </form>
      {d.notes.length ? (
        <ul className="cf-parent-rows">
          {d.notes.map((n) => (
            <li key={n.id}>
              <span><small>{n.author} · {new Date(n.createdAt).toLocaleDateString()}{n.essayId && essayName(n.essayId) ? ` · ${essayName(n.essayId)}` : ""}</small><span className="cf-note-body">{n.body}</span></span>
              {n.mine ? <button type="button" className="cf-link-btn" disabled={busy} onClick={() => { if (window.confirm("Delete this note?")) send({ action: "delete-note", noteId: n.id }); }}>Delete</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </ParentSection>
  );
}

function StudentView({ d, onChange }) {
  const name = firstOf(d.student.name);
  const counselor = d.role === "counselor";
  const deadlines = deadlinesOf(d);
  const essays = d.essays ? [...(d.essays.commonApp || []), ...Object.entries(d.essays.supplements || {}).flatMap(([school, items]) => items.map((e) => ({ ...e, group: e.group || school })))] : [];
  return (
    <React.Fragment>
      <header className="cf-share-head">
        <h1>{name}’s applications</h1>
        <p>{d.student.cycle ? `${d.student.cycle} · ` : ""}{name} shares <strong>{d.levelLabel}</strong>: {d.levelSummary}. A decision shows here once {name} has opened it.</p>
      </header>

      {counselor ? <CounselorNotes d={d} essays={essays} onSaved={onChange} /> : null}

      <ParentSection title="Applications" count={d.progress.apps.length}>
        {d.progress.apps.length ? <ProgressView tracker={d.progress} editable={false} /> : <p className="cf-parent-empty">No applications yet.</p>}
      </ParentSection>

      <ParentSection title="Deadlines" count={deadlines.length || null}>
        {deadlines.length ? (
          <ul className="cf-parent-rows">
            {deadlines.map((x, i) => <li key={i}><span className="cf-nums cf-parent-date">{x.date}</span><span>{x.title}{x.detail ? <small>{x.detail}</small> : null}</span></li>)}
          </ul>
        ) : <p className="cf-parent-empty">No deadlines yet.</p>}
      </ParentSection>

      {d.colleges ? (
        <ParentSection title="College list" count={d.colleges.length}>
          {d.colleges.length ? (
            <ul className="cf-parent-rows">
              {d.colleges.map((c) => <li key={c.slug}><span><strong>{c.name || c.short}</strong>{c.location ? <small>{c.location}</small> : null}</span><span className="cf-parent-meta">{c.tier === "safety" ? "Likely" : c.tier ? c.tier[0].toUpperCase() + c.tier.slice(1) : ""}{c.admit ? ` · ${c.admit} admit` : ""}{c.netPrice ? ` · ${c.netPrice} net` : ""}</span></li>)}
            </ul>
          ) : <p className="cf-parent-empty">No colleges on the list yet.</p>}
        </ParentSection>
      ) : null}

      {d.financialAid ? (
        <ParentSection title="Money and letters">
          <ul className="cf-parent-rows">
            <li><span>FAFSA</span><span className="cf-parent-meta">{word(d.financialAid.fafsaStatus)}</span></li>
            <li><span>CSS Profile</span><span className="cf-parent-meta">{word(d.financialAid.cssStatus)}</span></li>
            {d.financialAid.idocStatus && d.financialAid.idocStatus !== "n_a" ? <li><span>IDOC</span><span className="cf-parent-meta">{word(d.financialAid.idocStatus)}</span></li> : null}
            {(d.scholarships || []).map((s) => <li key={s.id}><span>{s.name}{s.amount ? <small>{s.amount}</small> : null}</span><span className="cf-parent-meta">{word(s.status)}</span></li>)}
            {(d.recommendations || []).map((r) => <li key={r.id}><span>Letter: {r.name}{r.subject ? <small>{r.subject}</small> : null}</span><span className="cf-parent-meta">{word(r.status)}</span></li>)}
          </ul>
        </ParentSection>
      ) : null}

      {(d.aidBySchool || []).length ? (
        <ParentSection title="Aid forms by school" count={d.aidBySchool.length}>
          <ul className="cf-parent-rows">
            {d.aidBySchool.map((r) => {
              const forms = r.ignoreAid ? "Not applying for aid" : [r.css === "required" ? "CSS Profile" : r.css === "unknown" ? "CSS Profile: check the school's aid page" : "CSS Profile not required", r.idoc ? "IDOC" : ""].filter(Boolean).join(" · ");
              const next = (r.deadlines || []).find((x) => x.kind === "aid");
              return <li key={r.appId}><span><strong>{r.name}</strong><small>{forms}</small></span><span className="cf-parent-meta cf-nums">{next ? `Aid due ${next.date}` : ""}</span></li>;
            })}
          </ul>
        </ParentSection>
      ) : null}

      {d.profile ? (
        <ParentSection title="Profile">
          <dl className="cf-parent-stats">
            {[["GPA (weighted)", d.applicant.gpaWeighted], ["GPA (unweighted)", d.applicant.gpaUnweighted], ["SAT", d.applicant.sat], ["ACT", d.profile.testing && d.profile.testing.act]].map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd className="cf-nums">{v || "—"}</dd></div>
            ))}
          </dl>
          <p className="cf-parent-line">{[d.profile.intended, d.profile.hs, d.profile.gradYear ? `Class of ${d.profile.gradYear}` : ""].filter(Boolean).join(" · ") || "No profile details yet."}</p>
          {(d.profile.activities || []).length ? (
            <ol className="cf-parent-rows">
              {[...d.profile.activities].sort((a, b) => a.rank - b.rank).map((a) => <li key={a.rank + a.name}><span><strong>{a.name}</strong>{a.desc ? <small>{a.desc}</small> : null}</span><span className="cf-parent-meta">{a.role || a.type || ""}</span></li>)}
            </ol>
          ) : null}
        </ParentSection>
      ) : null}

      {d.essays ? (
        <ParentSection title="Essays" count={essays.length}>
          {essays.length ? essays.map((e) => {
            const draft = (d.essayDrafts && d.essayDrafts[e.id]) || "";
            const count = /character/i.test(e.unit) ? Array.from(draft).length : draft.trim() ? draft.trim().split(/\s+/).length : 0;
            return (
              <details key={e.id} className="cf-parent-essay">
                <summary>{e.group ? `${e.group} · ` : ""}{e.label} <span className="cf-nums">{count}/{e.limit} {e.unit}</span></summary>
                <p className="cf-parent-prompt">{e.prompt}</p>
                <div className="cf-parent-draft">{draft.trim() ? draft : "No draft yet."}</div>
                {counselor ? d.notes.filter((n) => n.essayId === e.id).map((n) => <p key={n.id} className="cf-essay-note"><small>{n.author}</small>{n.body}</p>) : null}
              </details>
            );
          }) : <p className="cf-parent-empty">No essays yet.</p>}
        </ParentSection>
      ) : null}
    </React.Fragment>
  );
}

function ParentDashboard({ account }) {
  const [students, setStudents] = React.useState(null);
  const [selected, setSelected] = React.useState("");
  const [view, setView] = React.useState(null);
  const [error, setError] = React.useState("");

  const loadList = React.useCallback(async () => {
    setError("");
    try {
      const data = await getJson("/api/parent");
      setStudents(data.students);
      // One student opens straight away; more open on the roster ("").
      setSelected((cur) => (data.students.some((s) => s.id === cur) ? cur : data.students.length === 1 ? data.students[0].id : ""));
    } catch (e) { setError(e.message); }
  }, []);
  React.useEffect(() => { loadList(); }, [loadList]);
  const roles = new Set((students || []).map((s) => s.role));
  const board = roles.size === 1 && roles.has("counselor") ? "Counselor" : roles.size === 1 || !students ? (account && account.parent && account.parent.counselor ? "Counselor" : "Parent") : "Family & counselor";
  React.useEffect(() => { document.title = `${board} dashboard · College Forge`; }, [board]);

  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!selected) { setView(null); return; }
    let live = true;
    setView(null);
    getJson("/api/parent/" + encodeURIComponent(selected)).then((d) => { if (live) setView(d); }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [selected, attempt]);
  const retry = () => { setError(""); loadList(); setAttempt((n) => n + 1); };

  const startOwn = () => {
    try { localStorage.setItem(ownKey(account), "1"); } catch (e) {}
    window.location.href = "/hub/index.html";
  };
  const signOut = async () => { await window.cfApi.signOut(); window.location.href = "/"; };
  const email = account && account.user ? account.user.email : "";

  return (
    <div className="cf-share-page cf-parent">
      <div className="cf-parent-bar">
        <div className="cf-share-brand"><span aria-hidden="true">✱</span>College Forge<Badge variant="cream" uppercase>{board}</Badge></div>
        <div className="cf-parent-account">
          {email ? <span>{email}</span> : null}
          <button type="button" className="cf-link-btn" onClick={signOut}>Sign out</button>
        </div>
      </div>

      {students && students.length > 1 && selected ? (
        <nav className="cf-parent-tabs" aria-label="Students">
          <button type="button" onClick={() => { setSelected(""); loadList(); }}>← All students</button>
        </nav>
      ) : null}

      {error ? <div role="alert" className="cf-parent-error">{error} <Button size="sm" variant="secondary" onClick={retry}>Try again</Button></div> : null}
      {students && !students.length && !error ? (
        <header className="cf-share-head"><h1>No students yet</h1><p>When a student invites you from Forge, open the link in the email to start following their applications.</p></header>
      ) : null}
      {students && students.length > 1 && !selected ? <Roster students={students} onOpen={(id) => { setSelected(id); window.scrollTo(0, 0); }} />
        // A save that finishes after the counselor opened another student must not replace that student's view.
        : view && view.id === selected ? <StudentView d={view} onChange={(d) => setView((cur) => (cur && cur.id === d.id ? d : cur))} />
        : !error && (students === null || students.length) ? <div className="cf-parent-empty" role="status">Loading…</div> : null}

      <footer className="cf-parent-foot">
        Applying to college yourself? <button type="button" className="cf-link-btn" onClick={startOwn}>Start your own applications</button>
      </footer>
    </div>
  );
}
window.ParentDashboard = ParentDashboard;
