const { Button } = window.CollegeForgeDesignSystem_e95e63;

// Demonstrated interest and interviews for one school (lib/interest-log.ts), plus the Progress tab's
// "interviews coming up" and "thank-you notes owed" lists.

const INTEREST_KINDS = [
  { id: "visit", label: "Campus visit" },
  { id: "info_session", label: "Info session" },
  { id: "virtual_session", label: "Virtual session" },
  { id: "fair", label: "College fair" },
  { id: "interview", label: "Interview" },
  { id: "ao_contact", label: "Admissions officer contact" },
  { id: "email_opened", label: "Opened their emails" },
  { id: "other", label: "Other" },
];
const kindLabel = (id) => (INTEREST_KINDS.find((k) => k.id === id) || INTEREST_KINDS[INTEREST_KINDS.length - 1]).label;

const COUNTS_TEXT = { important: "Interest counts a lot", considered: "Interest is considered", not_considered: "Interest not tracked", unknown: "" };
const INTERVIEW_TEXT = { evaluative: "Interviews count", informational: "Interviews are informational", by_invitation: "Interviews by invitation", not_offered: "No interviews", unknown: "" };

function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** One sourced policy line: what the school says, linked to the page it came from. */
function PolicyChip({ text, fact }) {
  if (!text || !fact) return null;
  return (
    <a className="cf-interest__chip" href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" title={fact.text}>
      {text} <span aria-hidden="true">↗</span><span className="cf-sr-only"> (source: {fact.text})</span>
    </a>
  );
}

function InterestRow({ event, appId, act, busy, onPrep }) {
  const { fmtDate } = window.cfApp;
  const [showPrep, setShowPrep] = React.useState(false);
  const isInterview = event.kind === "interview";
  const set = (change, message) => act({ action: "interest-set", id: appId, interestId: event.id, ...change }, message);
  return (
    <li className="cf-interest__row">
      <div className="cf-interest__when">{fmtDate(event.date)}{event.time ? <small>{fmtTime(event.time)}</small> : null}</div>
      <div className="cf-interest__what">
        <strong>{kindLabel(event.kind)}</strong>{event.who ? ` · ${event.who}` : ""}
        {!event.done ? <span className="cf-research-tag">Coming up</span> : null}
        {event.notes ? <p>{event.notes}</p> : null}
        {event.prep ? (
          <React.Fragment>
            <button type="button" className="cf-link-btn" aria-expanded={showPrep} onClick={() => setShowPrep(!showPrep)}>{showPrep ? "Hide prep" : "Show prep"}</button>
            {showPrep ? <p className="cf-interest__prep">{event.prep}</p> : null}
          </React.Fragment>
        ) : null}
        <div className="cf-row-actions">
          {!event.done ? <button type="button" className="cf-link-btn" disabled={busy} onClick={() => set({ done: true }, "Marked done.")}>Mark done</button> : null}
          {isInterview && event.done ? (
            <label className="cf-interest__check">
              <input type="checkbox" checked={!!event.thankYouSent} disabled={busy} onChange={(e) => set({ thankYouSent: e.target.checked }, e.target.checked ? "Thank-you note marked sent." : "Thank-you note marked not sent.")} />
              <span>Thank-you note sent</span>
            </label>
          ) : null}
          {isInterview && !event.done && onPrep ? <button type="button" className="cf-link-btn" onClick={() => onPrep(event)}>Prep with the copilot</button> : null}
          <button type="button" className="cf-link-btn cf-link-btn--danger" disabled={busy} onClick={() => set({ remove: true }, "Removed.")}>Remove</button>
        </div>
      </div>
    </li>
  );
}

/** Mounted in AppDetails: the school's sourced policy, what the student logged, and a form to add more. */
function InterestLog({ app, act, busy }) {
  const empty = { kind: "visit", date: window.cfApp.todayIso(), time: "", who: "", notes: "" };
  const [form, setForm] = React.useState(empty);
  const signal = app.interestSignal || { counts: "unknown", interview: "unknown" };
  const events = app.interest || [];
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const ask = typeof window.cfAsk === "function" ? window.cfAsk : null;
  const onPrep = ask
    ? (event) => ask(`Help me prepare for my ${app.name} interview on ${event.date}${event.who ? ` with ${event.who}` : ""}. Use interview_prep with entry_id ${event.id}, draft 8 likely questions with talking points from my own activities and why-us draft, and save them to that interview (set_interest, entry_id ${event.id}) once I've seen them.`)
    : null;
  const submit = (e) => {
    e.preventDefault();
    const { time, who, notes, ...rest } = form;
    act({ action: "interest-add", id: app.id, ...rest, ...(time ? { time } : {}), ...(who.trim() ? { who: who.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) }, "Logged.")
      .then((ok) => ok && setForm({ ...empty, kind: form.kind }));
  };
  const chips = [<PolicyChip key="c" text={COUNTS_TEXT[signal.counts]} fact={signal.countsFact} />, <PolicyChip key="i" text={INTERVIEW_TEXT[signal.interview]} fact={signal.interviewFact} />];
  return (
    <div className="cf-interest">
      <h3 className="cf-subhead">Interest and interviews</h3>
      {signal.countsFact || signal.interviewFact ? <div className="cf-interest__chips">{chips}</div> : null}
      {signal.nudge ? <p className="cf-help cf-interest__nudge">{signal.nudge}</p> : null}
      {events.length ? (
        <ul className="cf-interest__list">
          {events.map((ev) => <InterestRow key={ev.id} event={ev} appId={app.id} act={act} busy={busy} onPrep={onPrep} />)}
        </ul>
      ) : <p className="cf-help" style={{ marginBottom: 10 }}>Log visits, info sessions, fairs, interviews and emails with your regional admissions officer. Booked interviews go on your calendar.</p>}
      <form className="cf-fields" style={{ alignItems: "end" }} onSubmit={submit}>
        <label className="cf-field">What
          <select value={form.kind} onChange={set("kind")}>
            {INTEREST_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        <label className="cf-field">Date
          <input type="date" value={form.date} onChange={set("date")} required />
        </label>
        <label className="cf-field">Time
          <input type="time" value={form.time} onChange={set("time")} />
        </label>
        <label className="cf-field">Who
          <input value={form.who} onChange={set("who")} maxLength={120} placeholder={form.kind === "interview" ? "Interviewer" : "Regional officer or event"} />
        </label>
        <label className="cf-field" style={{ gridColumn: "1 / -1" }}>Notes
          <input value={form.notes} onChange={set("notes")} maxLength={1000} placeholder="What you learned, who you met, what to mention later" />
        </label>
        <div><Button type="submit" size="sm" variant="secondary" disabled={busy || !form.date}>Log it</Button></div>
      </form>
    </div>
  );
}

/** Progress tab: interviews ahead and thank-you notes still owed, across schools. */
function InterviewsAhead({ apps }) {
  const { fmtDate, relDays, todayIso } = window.cfApp;
  const today = todayIso();
  const all = apps.flatMap((a) => (a.interest || []).filter((e) => e.kind === "interview").map((e) => ({ app: a, event: e })));
  const key = (r) => `${r.event.date} ${r.event.time || "99:99"}`;
  const ahead = all.filter((r) => !r.event.done && r.event.date >= today).sort((x, y) => key(x).localeCompare(key(y)));
  const owed = all.filter((r) => r.event.done && !r.event.thankYouSent).sort((x, y) => key(x).localeCompare(key(y)));
  if (!ahead.length && !owed.length) return null;
  const row = (r, note) => (
    <li key={r.event.id} className="cf-interest__row">
      <div className="cf-interest__when">{fmtDate(r.event.date)}{r.event.time ? <small>{fmtTime(r.event.time)}</small> : null}</div>
      <div className="cf-interest__what"><strong>{r.app.name}</strong>{r.event.who ? ` · ${r.event.who}` : ""} <span className="cf-help" style={{ display: "inline" }}>{note(r)}</span></div>
    </li>
  );
  return (
    <section className="cf-psection" aria-labelledby="cf-interviews-title">
      <h2 id="cf-interviews-title" className="cf-psection__title">Interviews</h2>
      {ahead.length ? (
        <React.Fragment>
          <h3 className="cf-subhead">Coming up</h3>
          <ul className="cf-interest__list">{ahead.map((r) => row(r, (x) => relDays(x.event.date)))}</ul>
        </React.Fragment>
      ) : null}
      {owed.length ? (
        <React.Fragment>
          <h3 className="cf-subhead" style={{ marginTop: ahead.length ? 14 : 0 }}>Thank-you notes owed</h3>
          <ul className="cf-interest__list">{owed.map((r) => row(r, () => "Interviewed; no thank-you sent yet"))}</ul>
        </React.Fragment>
      ) : null}
    </section>
  );
}

window.InterestLog = InterestLog;
window.InterviewsAhead = InterviewsAhead;
