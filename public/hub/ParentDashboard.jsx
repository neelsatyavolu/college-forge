const { Badge, Button } = window.CollegeForgeDesignSystem_e95e63;

/**
 * The parent dashboard: read-only, one student at a time, cut on the server to the level the student chose
 * (lib/parent-view.ts). Opens instead of the hub for a parent with no applications of their own, or with
 * ?view=parent. A parent who also applies can start their own workspace from the footer.
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

async function getJson(url) {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
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

function StudentView({ d }) {
  const name = (d.student.name || "Your student").split(/\s+/)[0];
  const deadlines = deadlinesOf(d);
  const essays = d.essays ? [...(d.essays.commonApp || []), ...Object.entries(d.essays.supplements || {}).flatMap(([school, items]) => items.map((e) => ({ ...e, group: e.group || school })))] : [];
  return (
    <React.Fragment>
      <header className="cf-share-head">
        <h1>{name}’s applications</h1>
        <p>{d.student.cycle ? `${d.student.cycle} · ` : ""}{name} shares <strong>{d.levelLabel}</strong>: {d.levelSummary}. A decision shows here once {name} has opened it.</p>
      </header>

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
            {(d.scholarships || []).map((s) => <li key={s.id}><span>{s.name}{s.amount ? <small>{s.amount}</small> : null}</span><span className="cf-parent-meta">{word(s.status)}</span></li>)}
            {(d.recommendations || []).map((r) => <li key={r.id}><span>Letter: {r.name}{r.subject ? <small>{r.subject}</small> : null}</span><span className="cf-parent-meta">{word(r.status)}</span></li>)}
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
      setSelected((cur) => (data.students.some((s) => s.id === cur) ? cur : (data.students[0] && data.students[0].id) || ""));
    } catch (e) { setError(e.message); }
  }, []);
  React.useEffect(() => { loadList(); }, [loadList]);
  React.useEffect(() => { document.title = "Parent dashboard · College Forge"; }, []);

  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!selected) return;
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
        <div className="cf-share-brand"><span aria-hidden="true">✱</span>College Forge<Badge variant="cream" uppercase>Parent</Badge></div>
        <div className="cf-parent-account">
          {email ? <span>{email}</span> : null}
          <button type="button" className="cf-link-btn" onClick={signOut}>Sign out</button>
        </div>
      </div>

      {students && students.length > 1 ? (
        <nav className="cf-parent-tabs" aria-label="Students">
          {students.map((s) => <button key={s.id} type="button" aria-current={s.id === selected ? "page" : undefined} onClick={() => setSelected(s.id)}>{s.name}</button>)}
        </nav>
      ) : null}

      {error ? <div role="alert" className="cf-parent-error">{error} <Button size="sm" variant="secondary" onClick={retry}>Try again</Button></div> : null}
      {students && !students.length && !error ? (
        <header className="cf-share-head"><h1>No students yet</h1><p>When your student invites you from Forge, open the link in the email to start following their applications.</p></header>
      ) : null}
      {view ? <StudentView d={view} /> : !error && (students === null || students.length) ? <div className="cf-parent-empty" role="status">Loading…</div> : null}

      <footer className="cf-parent-foot">
        Applying to college yourself? <button type="button" className="cf-link-btn" onClick={startOwn}>Start your own applications</button>
      </footer>
    </div>
  );
}
window.ParentDashboard = ParentDashboard;
