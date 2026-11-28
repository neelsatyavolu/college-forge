// Onboarding v2: the student connects their AI, which interviews them in a chat (tiles come from
// its tool calls), proposes a list, researches each school while they watch, recommends an ED/EA
// plan, then builds the timeline. Progress lives in the workspace, so a closed tab resumes.
const { Button: OcBtn } = window.CollegeForgeDesignSystem_e95e63;

const OC_SECTIONS = [["basics", "Basics"], ["school", "Grades"], ["testing", "Testing"], ["activities", "Activities"], ["campus", "Campus"], ["money", "Money"], ["early", "Early plans"], ["deep", "Deeper"]];
const OC_KICKOFF = "Hi! I'm ready to set up Forge.";
const OC_RESEARCH_DONE = "Research is done. Recommend my early application plan.";
const OC_CONFIRM = "Yes, that plan sounds right. Save my Early Decision and Early Action choices.";
const OC_SHOW_LIST = "Show me my draft college list.";
/** Messages Forge sends on the student's behalf: kept in the AI's history, not shown as theirs. */
const OC_HIDDEN = new Set([OC_KICKOFF, OC_RESEARCH_DONE, OC_CONFIRM, OC_SHOW_LIST]);
const OC_RESEARCH_CONCURRENCY = 6;
const OC_POLL_MS = 4000;
const OC_HISTORY = 16;

function ocProviderBody() {
  const p = typeof loadAiPrefs === "function" ? loadAiPrefs() : {};
  const body = {};
  if (p.preferred && p.preferred !== "auto" && p.preferred !== "opencode") body.provider = p.preferred;
  if (p.grokModel) body.grokModel = p.grokModel;
  if (p.codexModel) body.codexModel = p.codexModel;
  return body;
}

/** Streams one chat request; calls onEvent for every NDJSON event. Resolves with the reply text. */
async function ocStream(messages, mode, onEvent) {
  const res = await fetch("/api/ai/chat", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, ...(mode ? { mode } : {}), ...ocProviderBody() }),
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `The AI request failed (${res.status}).`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", failure = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
      if (ev.type === "delta") text += ev.text;
      if (ev.type === "error") failure = ev.message;
      onEvent(ev);
    }
  }
  if (failure) throw new Error(failure);
  return text;
}

function ocTurnsFrom(transcript) {
  return (transcript || []).map((t) => ({ role: t.role, content: t.content || "", ui: t.ui }));
}

function OcConnectGate({ onConnected, onCancel }) {
  const [flow, setFlow] = React.useState(null);
  const [callback, setCallback] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const start = async (provider) => {
    setErr(""); setBusy(true); setFlow(provider);
    try {
      const res = await fetch(`/api/auth/${provider}/start`, { method: "POST", credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not start sign-in.");
      window.open(j.authorizeUrl, "_blank", "noopener");
    } catch (e) { setErr(e.message); setFlow(null); }
    setBusy(false);
  };
  const complete = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await fetch(`/api/auth/${flow}/complete`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ callback: callback.trim() }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sign-in didn't finish. Try again.");
      await onConnected();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <section className="oc-connect">
      <h1>Let's set up your applications</h1>
      <p>Forge runs on your own AI. Connect ChatGPT or Grok and it will interview you, build a college list that fits, and research every school on it.</p>
      <p className="oc-fine">Your answers, including what you share about money, are sent to the AI you connect. It runs on your own ChatGPT or Grok plan.</p>
      {!flow ? (
        <div className="oc-connect-actions">
          <OcBtn onClick={() => start("codex")} disabled={busy}>Connect ChatGPT</OcBtn>
          <OcBtn variant="secondary" onClick={() => start("grok")} disabled={busy}>Connect Grok</OcBtn>
        </div>
      ) : (
        <div className="oc-connect-step">
          <p>Sign in to {flow === "grok" ? "Grok" : "ChatGPT"} on the tab that opened:</p>
          <window.CfConnectSteps provider={flow} />
          <div className="oc-tile-row">
            <input className="oc-input" aria-label={(flow === "grok" ? "Grok" : "ChatGPT") + " sign-in response"} autoComplete="off" spellCheck={false} placeholder={window.cfConnectPlaceholder(flow)} value={callback} onChange={(e) => setCallback(e.target.value)} />
            <OcBtn size="sm" disabled={busy || !callback.trim()} onClick={complete}>Connect</OcBtn>
          </div>
          <button type="button" className="oc-link" onClick={() => { setFlow(null); setCallback(""); }}>Use a different AI</button>
        </div>
      )}
      {err && <p className="oc-error" role="alert">{err}</p>}
      {onCancel && <button type="button" className="oc-link oc-leave" onClick={onCancel}>Back to workspace</button>}
    </section>
  );
}

/** Drops a paragraph that repeats an earlier one in the same reply (mirrors dedupeParagraphs on the server). */
function ocDedupe(text) {
  const words = (p) => new Set(p.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const kept = [];
  for (const para of (text || "").split(/\n{2,}/)) {
    const w = words(para);
    const repeat = w.size > 3 && kept.some((k) => [...w].filter((x) => k.w.has(x)).length / Math.min(w.size, k.w.size) >= 0.7);
    if (!repeat && para.trim()) kept.push({ text: para, w });
  }
  return kept.map((k) => k.text).join("\n\n");
}

function OcMessage({ m, live, busy, data, profile, revision, onAnswer, onApprove, onRevise, onConfirm }) {
  const ui = m.ui || {};
  const content = m.role === "assistant" ? ocDedupe(m.content) : m.content;
  return (
    <div className={"oc-msg oc-msg--" + m.role}>
      {content && <div className="oc-bubble">{m.role === "assistant" ? window.ocRich(content) : content}</div>}
      {live && ui.question && <window.OcQuestion q={ui.question} lead={content} data={data} profile={profile} revision={revision} disabled={busy} onAnswer={onAnswer} />}
      {live && ui.list && <window.OcListTiles schools={ui.list} edIdea={ui.edIdea} transferPath={ui.transferPath} warning={ui.warning} disabled={busy} onApprove={onApprove} onRevise={onRevise} />}
      {live && ui.strategy && <window.OcStrategyTiles strategy={ui.strategy} disabled={busy} onConfirm={onConfirm} onAnswer={onAnswer} />}
    </div>
  );
}

function OnboardingChat({ data, onComplete, onCancel }) {
  const [ai, setAi] = React.useState(null); // null loading, false not connected, true connected
  const [ws, setWs] = React.useState(data);
  const [turns, setTurnsState] = React.useState(() => ocTurnsFrom(data?.onboarding?.interview?.transcript));
  const [busy, setBusyState] = React.useState(false);
  // Async flows (research, plan) outlive a render, so they read the latest values from refs.
  const turnsRef = React.useRef(turns);
  const busyRef = React.useRef(false);
  const setTurns = (next) => { turnsRef.current = typeof next === "function" ? next(turnsRef.current) : next; setTurnsState(turnsRef.current); };
  const setBusy = (b) => { busyRef.current = b; setBusyState(b); };
  const [status, setStatus] = React.useState("");
  const [error, setError] = React.useState("");
  const [cards, setCards] = React.useState([]);
  const [draft, setDraft] = React.useState("");
  /** The answer whose turn failed: { text, run? }. "Try again" resends it; "Edit answer" moves it into the answer box. */
  const [retry, setRetry] = React.useState(null);
  const [chatOpen, setChatOpen] = React.useState(false);
  // The answer box grows with what the student types (2 lines up to about 8), then scrolls.
  const boxRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 220)}px`;
  }, [draft]);
  const started = React.useRef(false);
  const endRef = React.useRef(null);
  const iv = ws?.onboarding?.interview;
  const phase = iv?.phase || "interview";

  const reload = async () => { const next = await window.cfApi.getWorkspace(); setWs(next); return next; };
  const checkAi = async () => {
    const s = await fetch("/api/ai/status", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    setAi(Boolean(s.codexConnected || s.grokConnected));
  };
  React.useEffect(() => { checkAi(); }, []);
  // Follow the conversation as replies stream in and tiles appear, unless the student scrolled up to read.
  // The thread is its own scroll area between the header and the answer box, so nothing can end up
  // hidden under the answer box. It follows new content unless the student scrolled up to read.
  const scrollRef = React.useRef(null);
  const followRef = React.useRef(true);
  // Only the student's own scrolling (wheel, touch, keys, scrollbar drag) decides whether to keep following;
  // scroll events from layout changes (a tall tile closing, the window resizing) are ignored.
  const userScrollAt = React.useRef(0);
  const markUserScroll = () => { userScrollAt.current = Date.now(); };
  const onThreadScroll = () => {
    const el = scrollRef.current;
    if (!el || Date.now() - userScrollAt.current > 800) return;
    followRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 120;
  };
  React.useLayoutEffect(() => {
    const last = turns[turns.length - 1];
    if (last && last.role === "user") followRef.current = true;
    const el = scrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [turns, busy, cards, status, error]);
  // Tiles and images can grow after render (fonts, layout); keep the bottom in view while following.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Content growing, or the thread shrinking (a phone keyboard opening, a smaller window), keeps the bottom in view.
    const ro = new ResizeObserver(() => { if (followRef.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [ai]);

  /** Sends one student message to the interviewer and streams the reply. Resolves true when the reply arrived. */
  const send = async (text) => {
    if (busyRef.current || !text.trim()) return false;
    setError(""); setRetry(null); setBusy(true); setStatus("Thinking…");
    const before = turnsRef.current;
    const history = [...before, { role: "user", content: text }];
    setTurns([...history, { role: "assistant", content: "" }]);
    let reply = "", ui = null;
    try {
      await ocStream(history.slice(-OC_HISTORY).map((t) => ({ role: t.role, content: t.content || "(shown as tiles)" })), "onboarding", (ev) => {
        if (ev.type === "status") setStatus(window.cfChatStatus?.softenStatusMessage ? window.cfChatStatus.softenStatusMessage(ev.message) : ev.message);
        if (ev.type === "delta") reply += ev.text;
        if (ev.type === "question") ui = { question: ev.question };
        if (ev.type === "list") ui = { list: ev.schools, ...(ev.edIdea ? { edIdea: ev.edIdea } : {}), ...(ev.transferPath ? { transferPath: ev.transferPath } : {}), ...(ev.warning ? { warning: ev.warning } : {}) };
        if (ev.type === "strategy") ui = { strategy: ev.strategy };
        if (ev.type === "delta" || ev.type === "question" || ev.type === "list" || ev.type === "strategy") {
          setTurns([...history, { role: "assistant", content: reply, ui }]);
        }
      });
      const next = await reload();
      setBusy(false); setStatus("");
      // The interview is done but the AI ended its turn without a list: ask for it once.
      const nextIv = next?.onboarding?.interview;
      if (nextIv?.phase === "list" && !(nextIv.listDraft || []).length && !(ui && ui.list) && text !== OC_SHOW_LIST) return send(OC_SHOW_LIST);
      return true;
    } catch (e) {
      // Put the thread back as it was before this answer, so the last question keeps its tiles,
      // and keep the answer itself so "Try again" resends exactly it (or the student edits it first).
      setError(e.message || "Something went wrong. Try again.");
      setTurns(before);
      setRetry({ text });
      // A tile may have saved to the profile before the AI failed; fresh data keeps its next save from conflicting.
      reload().catch(() => {});
    }
    setBusy(false); setStatus("");
    return false;
  };

  // Start or resume the interview once the AI is connected.
  React.useEffect(() => {
    if (ai !== true || started.current) return;
    started.current = true;
    (async () => {
      let current = ws;
      if (!current?.onboarding?.interview || current.onboarding.interview.phase === "done") {
        current = (await window.cfApi.postAction("start-interview", {})).data;
        setWs(current); setTurns([]);
      }
      const p = current.onboarding.interview.phase;
      if (p === "research") return runResearch();
      if (p === "plan") return runPlan();
      if (!current.onboarding.interview.transcript.length) send(OC_KICKOFF);
    })().catch((e) => setError(e.message));
  }, [ai]);

  const approve = async (keep, drop) => {
    setBusy(true); setError("");
    try {
      await window.cfApi.postAction("apply-list", { keep, drop });
      setTurns((t) => [...t, { role: "user", content: `Let's research these ${keep.length} schools.` }, { role: "assistant", content: "", board: true }]);
      await reload();
      setBusy(false);
      await runResearch();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const revise = (note, dropped) => send(dropped.length ? `${note} (I'd drop: ${dropped.join(", ")})` : note);

  /** Finishes research: the AI recommends rounds, unless some schools failed. */
  const afterResearch = async (failedCount) => {
    await reload();
    setBusy(false); setStatus("");
    if (failedCount) {
      setError(`Research didn't finish for ${failedCount} ${failedCount === 1 ? "school" : "schools"} because the AI didn't answer.`);
      return;
    }
    const ok = await send(OC_RESEARCH_DONE);
    // The AI must answer with a recommendation; without one the phase can't move, so offer a retry.
    if (ok && (await reload())?.onboarding?.interview?.phase === "research") setError("The AI didn't suggest an early plan yet.");
  };

  /**
   * Research runs on Forge's server (app/api/ai/research-run), six schools at a time, and keeps going
   * if this tab closes; the page only shows progress. Without the server set up, it runs here instead.
   */
  const runResearch = async () => {
    setBusy(true); setError(""); setStatus("Researching your schools… You can close this tab; it keeps going.");
    try {
      const res = await fetch("/api/ai/research-run", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start", ...ocProviderBody() }) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 503 && j.fallback) return runResearchHere();
      if (!res.ok) throw new Error(j.error || "Research couldn't start. Try again.");
      let view = j;
      for (;;) {
        setCards(view.cards || []);
        if (view.finished) break;
        setStatus(view.error ? `Retrying a few schools (${view.error})` : "Researching your schools… You can close this tab; it keeps going.");
        if (view.error && !view.active) throw new Error(view.error);
        await new Promise((r) => setTimeout(r, OC_POLL_MS));
        view = await fetch("/api/ai/research-run", { credentials: "same-origin" }).then((r) => r.json()).catch(() => view);
      }
      // One more check hands this browser the newest sign-in and lets Forge delete its stored copy.
      await fetch("/api/ai/research-run", { credentials: "same-origin" }).catch(() => {});
      const stuck = (view.cards || []).filter((c) => c.stage === "queued").length;
      await afterResearch(stuck);
    } catch (e) {
      setError(e.message || "Research stopped. Try again."); setBusy(false); setStatus("");
    }
  };

  /** The in-browser fallback: researches each school while the student watches; resumes where it stopped. */
  const runResearchHere = async () => {
    setBusy(true); setError(""); setStatus("Researching your schools…");
    try {
      const startRes = await fetch("/api/ai/research-plan", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) }).then((r) => r.json());
      if (startRes.error) throw new Error(startRes.error);
      const fresh = await reload();
      const stageOf = (c) => (c.research?.complete ? "done" : c.research?.needsReview ? "needs_review" : "queued");
      setCards(fresh.colleges.map((c) => ({ slug: c.slug, name: c.short || c.name, stage: stageOf(c), facts: c.research?.facts?.length || 0 })));
      const update = (slug, patch) => setCards((cs) => cs.map((c) => (c.slug === slug ? { ...c, ...patch } : c)));
      let queue = startRes.steps || [];
      const running = new Set();
      const failed = new Set();
      const worker = async () => {
        while (queue.length) {
          const step = queue.shift();
          if (running.has(step.slug)) continue;
          running.add(step.slug);
          update(step.slug, { stage: "searching" });
          try {
            await ocStream([{ role: "user", content: step.prompt }], "research", (ev) => {
              if (ev.type === "tool" && ev.name === "web_fetch") update(step.slug, { stage: "reading" });
              if (ev.type === "research") update(ev.slug, { stage: ev.stage, facts: undefined, note: `${ev.facts} facts saved` });
            });
          } catch (e) {
            // A failed AI call (rate limit, network) isn't an attempt: the school stays queued for "Try again".
            running.delete(step.slug);
            failed.add(step.slug);
            update(step.slug, { stage: "queued", note: "The AI didn't answer. It will retry." });
            continue;
          }
          const after = await fetch("/api/ai/research-plan", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "attempt", slug: step.slug }) }).then((r) => r.json()).catch(() => ({ steps: [] }));
          running.delete(step.slug);
          const left = (after.steps || []).find((s) => s.slug === step.slug);
          if (left) queue.push(left);
          else {
            const latest = await reload();
            const c = latest.colleges.find((x) => x.slug === step.slug);
            update(step.slug, { stage: c ? stageOf(c) : "done", facts: c?.research?.facts?.length || 0, note: "" });
          }
        }
      };
      await Promise.all(Array.from({ length: OC_RESEARCH_CONCURRENCY }, worker));
      await afterResearch(failed.size);
    } catch (e) {
      setError(e.message || "Research stopped. Try again."); setBusy(false); setStatus("");
    }
  };

  /** After the student confirms the strategy: save it, then build rounds and the timeline. */
  const confirmStrategy = async () => {
    if (!(await send(OC_CONFIRM))) { setRetry({ text: OC_CONFIRM, run: confirmStrategy }); return; }
    try {
      await window.cfApi.postAction("set-interview-phase", { phase: "plan", strategyConfirmed: true });
    } catch (e) {
      setError(e.message || "Couldn't save that. Try again.");
      setRetry({ text: OC_CONFIRM, run: confirmStrategy });
      return;
    }
    await runPlan();
  };
  const runPlan = async () => {
    setBusy(true); setError("");
    try {
      const plan = await fetch("/api/ai/build-plan", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json());
      for (const step of [plan.rounds, plan.milestones].filter(Boolean)) {
        setStatus(`${step.label}…`);
        await ocStream([{ role: "user", content: step.prompt }], null, () => {});
      }
      const done = await window.cfApi.postAction("finish-onboarding", {});
      setBusy(false); setStatus("");
      onComplete(done.data, { buildPlan: false });
    } catch (e) { setError(e.message || "Couldn't finish setting up. Try again."); setBusy(false); setStatus(""); }
  };

  if (ai === null) return <div className="cf-loading-screen" role="status"><span className="cf-loading-mark">✱</span>Checking your AI connection…</div>;
  if (ai === false) return <div className="oc-shell"><OcConnectGate onConnected={checkAi} onCancel={onCancel} /></div>;

  const sectionIndex = Math.max(0, OC_SECTIONS.findIndex(([id]) => id === iv?.section));
  const lastAssistant = turns.map((t, i) => (t.role === "assistant" ? i : -1)).filter((i) => i >= 0).pop();
  const lastLive = !!(turns[lastAssistant] && turns[lastAssistant].ui && phase !== "research");
  // While the quick-start form is the live question, the answer box steps aside: a message typed
  // there would end the form's turn and take the form away. The student can still choose to chat.
  const formLive = lastLive && turns[lastAssistant].ui.question?.kind === "intake";
  const tryAgain = () => {
    if (phase === "research") return runResearch();
    if (phase === "plan") return runPlan();
    if (retry) return retry.run ? retry.run() : send(retry.text);
    setError("");
  };
  const editRetry = () => {
    setDraft(retry.text); setRetry(null); setError(""); setChatOpen(true);
    requestAnimationFrame(() => boxRef.current && boxRef.current.focus());
  };
  const stepLabel = phase === "interview" ? OC_SECTIONS[sectionIndex][1] : { list: "Your list", research: "Research", strategy: "Early plan", plan: "Timeline", done: "Done" }[phase];
  return (
    <div className="oc-shell oc-shell--chat">
      <header className="oc-head">
        <div className="oc-progress" aria-label={`Setup: ${stepLabel}`}>
          {OC_SECTIONS.map(([id, label], i) => (
            <span key={id} className={"oc-dot" + (phase !== "interview" || i < sectionIndex ? " is-done" : i === sectionIndex ? " is-on" : "")} title={label} />
          ))}
          <span className="oc-progress-label">{stepLabel}</span>
        </div>
        {onCancel && <button type="button" className="oc-link" onClick={onCancel}>Save and exit</button>}
      </header>
      <div className="oc-scroll" ref={scrollRef} onScroll={onThreadScroll} onWheel={markUserScroll} onTouchMove={markUserScroll}
        // Only a press on the scrollbar itself is scrolling; a click on a tile's button (which may collapse the tile) is not.
        onPointerDown={(e) => { if (e.target === e.currentTarget) markUserScroll(); }}
        // Keys typed into a field inside the thread (the intake form) aren't scrolling either.
        onKeyDown={(e) => { if (!e.target.closest("input, textarea, select, [contenteditable]") && ["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End", " "].includes(e.key)) markUserScroll(); }}>
      <main className="oc-thread">
        {turns.filter((t) => !(t.role === "user" && OC_HIDDEN.has(t.content))).map((m, i, shown) => (
          m.board
            ? (cards.length > 0 && <window.OcResearchBoard key={i} cards={cards} />)
            : <OcMessage key={i} m={m} live={m === turns[lastAssistant] && i === shown.length - 1 && phase !== "research"} busy={busy} data={ws} profile={ws?.profile} revision={ws?.revision}
                onAnswer={send} onApprove={approve} onRevise={revise} onConfirm={confirmStrategy} />
        ))}
        {!turns.some((t) => t.board) && cards.length > 0 && <window.OcResearchBoard cards={cards} />}
        {/* The AI answered a list question in words: keep the saved draft on screen so it can still be approved or changed. */}
        {phase === "list" && !busy && !(turns[lastAssistant] && turns[lastAssistant].ui && (turns[lastAssistant].ui.list || turns[lastAssistant].ui.question)) && ws?.onboarding?.interview?.listDraft?.length > 0 && (
          <div className="oc-msg oc-msg--assistant">
            <p className="oc-status">Your draft list, as it stands:</p>
            <window.OcListTiles schools={ws.onboarding.interview.listDraft} edIdea={ws.onboarding.interview.edIdea} transferPath={ws.onboarding.interview.transferPath} disabled={busy} onApprove={approve} onRevise={revise} />
          </div>
        )}
        {status && <p className="oc-status" role="status">{status}</p>}
        {error && (
          <div className="oc-error" role="alert">{error}{" "}
            <button type="button" className="oc-link" disabled={busy} onClick={tryAgain}>Try again</button>
            {retry && !retry.run && !OC_HIDDEN.has(retry.text) && <>{" "}<button type="button" className="oc-link" disabled={busy} onClick={editRetry}>Edit answer first</button></>}
          </div>
        )}
        <div ref={endRef} />
      </main>
      </div>
      {formLive && !chatOpen && !draft ? (
        <div className="oc-composer oc-composer--form">
          <span className="oc-tile-note">Fill in the form above and press Save and continue.</span>
          <button type="button" className="oc-link" disabled={busy} onClick={() => { setChatOpen(true); requestAnimationFrame(() => boxRef.current && boxRef.current.focus()); }}>Skip the form and just chat</button>
        </div>
      ) : (
      <form className="oc-composer" onSubmit={(e) => { e.preventDefault(); const t = draft; setDraft(""); send(t); }}>
        <textarea ref={boxRef} className="oc-input oc-composer-box" rows={2} aria-label="Your answer" placeholder={lastLive ? "Or type your answer…" : "Type your answer…"} value={draft} disabled={busy || phase === "research" || phase === "plan"}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const t = draft; setDraft(""); send(t); } }} />
        <OcBtn size="sm" type="submit" disabled={busy || !draft.trim()}>Send</OcBtn>
      </form>
      )}
    </div>
  );
}

window.OnboardingChat = OnboardingChat;
