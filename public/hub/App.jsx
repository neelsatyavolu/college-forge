const { Button } = window.CollegeForgeDesignSystem_e95e63;
const Onboarding = window.Onboarding;
const OnboardingChat = window.OnboardingChat;

// The sidebar's views, groups, page links and icons live in nav.js, shared with the full pages outside the hub.
const { NAV, GROUPS: NAV_GROUPS, PAGE_LINKS, ICONS: NAV_ICONS } = window.cfNav;
// Tabs that were folded into others keep working as links.
const VIEW_ALIASES = { portals: "applications", overview: "applications", planner: "timeline", compare: "shortlist" };

function NavIcon({ name }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={NAV_ICONS[name] || NAV_ICONS.home} /></svg>;
}

// The hash's view, or null for none (the hub then opens defaultView).
function readView() {
  // "#explore/<slug>" opens a school inside Explore; the view is the part before "/".
  const raw = window.location.hash.slice(1).split("/")[0];
  const h = VIEW_ALIASES[raw] || raw;
  return NAV.some(n => n.id === h) ? h : null;
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// With no hash: the Timeline once any school has a dated deadline, else the shortlist.
function defaultView(data, tracker) {
  const dated = (data.colleges || []).some(c => (c.deadlines || []).some(d => d && ISO_DATE.test(d.date || "")))
    || tracker.apps.some(a => ISO_DATE.test(a.deadline || ""));
  return dated ? "timeline" : "shortlist";
}

function App() {
  const [account, setAccount] = React.useState(null);
  const [parentMode, setParentMode] = React.useState(false);
  const [tracker, setTrackerState] = React.useState({ revision: -1, autocheck: true, apps: [] });
  // Parallel portal checks answer out of order; keep the newest workspace revision.
  const setTracker = React.useCallback(t => { if (t) setTrackerState(cur => ((t.revision || 0) >= (cur.revision || 0) ? t : cur)); }, []);
  const reloadTracker = React.useCallback(() => window.cfApi.applications().then(j => setTrackerState(j.data)).catch(() => {}), []);
  const [data, setData] = React.useState(window.CF_DATA);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [hashView, setView] = React.useState(readView);
  const [hash, setHash] = React.useState(() => window.location.hash);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatPrompt, setChatPrompt] = React.useState(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [mobile, setMobile] = React.useState(() => window.matchMedia("(max-width: 850px)").matches);
  const sidebarRef = React.useRef(null);
  const menuButtonRef = React.useRef(null);
  const chatReturnFocusRef = React.useRef(null);
  const home = defaultView(data, tracker);
  const view = hashView || home;
  // Scattergrams is a Maia Learning import, so its tab shows only once something was imported.
  const [hasScattergrams, setHasScattergrams] = React.useState(false);
  const [theme, setTheme] = React.useState(() => document.documentElement.getAttribute("data-theme") || "light");
  const [runOnboarding, setRunOnboarding] = React.useState(false);
  // Opens the wizard by itself once per page load, so "Return to workspace" is not undone by the next refresh.
  const autoOnboardRef = React.useRef(false);
  // Deadline and essay-prompt research after onboarding: { state: "running" | "done" | "error", message }.
  const [planTask, setPlanTask] = React.useState(null);
  const mainRef = React.useRef(null);

  const toggleTheme = () => setTheme(t => {
    const next = t === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("cf.theme", next); } catch (e) {}
    return next;
  });
  const applyWorkspace = React.useCallback((ws, allowSwitch = false) => {
    if (!ws) return;
    const current = window.CF_DATA;
    if (!allowSwitch && current?.draftStorageKey && ws.draftStorageKey !== current.draftStorageKey) return;
    if (ws.draftStorageKey && ws.draftStorageKey === current?.draftStorageKey &&
        Number.isSafeInteger(ws.revision) && Number.isSafeInteger(current.revision) &&
        ws.revision < current.revision) return;
    window.CF_DATA = ws;
    setData(ws);
  }, []);
  // The server keeps the college list and the applications in step (lib/list-sync.ts), so adding or removing
  // a school on one side reloads the other.
  const ids = list => (list || []).map(x => x.id || x.slug).sort().join("|");
  const reloadWorkspace = React.useCallback(() => window.cfApi.getWorkspace().then(ws => applyWorkspace(ws)).catch(() => {}), [applyWorkspace]);
  const setTrackerAndList = React.useCallback(t => {
    if (t && ids(t.apps) !== ids(tracker.apps)) reloadWorkspace();
    setTracker(t);
  }, [setTracker, reloadWorkspace, tracker]);
  const applyWorkspaceAndTracker = React.useCallback(ws => {
    if (ws && ids(ws.colleges) !== ids(window.CF_DATA && window.CF_DATA.colleges)) reloadTracker();
    applyWorkspace(ws);
  }, [applyWorkspace, reloadTracker]);
  const switchWorkspace = React.useCallback(ws => {
    setChatOpen(false);
    setChatPrompt(null);
    applyWorkspace(ws, true);
    reloadTracker();
  }, [applyWorkspace, reloadTracker]);
  const refresh = React.useCallback(async () => {
    const requestedScope = window.CF_DATA?.draftStorageKey;
    try {
      const me = await window.cfApi.me();
      setAccount(me);
      if (!me.signedIn) { setLoading(false); return; }
      if (window.cfWantsParentDashboard(me)) { setParentMode(true); setLoading(false); return; }
      const [ws, apps] = await Promise.all([window.cfApi.getWorkspace(), window.cfApi.applications()]);
      let setupDismissed = false;
      try { setupDismissed = localStorage.getItem("cf.setupBannerHidden." + (ws?.draftStorageKey || "local")) === "1"; } catch (e) {}
      if (me.needsOnboarding && !setupDismissed && !autoOnboardRef.current) { autoOnboardRef.current = true; setRunOnboarding(true); }
      setTrackerState(apps.data);
      if (requestedScope && requestedScope !== window.CF_DATA?.draftStorageKey) return;
      applyWorkspace(ws, true);
      setLoadError("");
    } catch (e) {
      if (requestedScope && requestedScope !== window.CF_DATA?.draftStorageKey) return;
      setLoadError("We couldn’t load your workspace. Please try again.");
    }
    setLoading(false);
  }, [applyWorkspace]);
  React.useEffect(() => { refresh(); }, [refresh]);
  const onScattergrams = view === "scattergrams";
  React.useEffect(() => {
    if (loading || !account || !account.signedIn || parentMode) return undefined;
    let live = true;
    window.cfApi.getScattergrams()
      .then(doc => { if (live) setHasScattergrams(!!(doc && doc.colleges && Object.keys(doc.colleges).length)); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [loading, account, parentMode, data?.draftStorageKey, onScattergrams]);
  React.useEffect(() => { setChatOpen(false); setChatPrompt(null); }, [data?.draftStorageKey]);
  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 850px)");
    const change = () => { setMobile(media.matches); setMenuOpen(false); };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  React.useEffect(() => {
    if (!menuOpen || !sidebarRef.current) return;
    // Some views (a school's page) have no current link; fall back to the first one.
    const target = sidebarRef.current.querySelector('[aria-current="page"]') || sidebarRef.current.querySelector("a, button");
    if (target) target.focus();
  }, [menuOpen]);
  React.useEffect(() => {
    const onHash = () => {
      const raw = window.location.hash.slice(1).split("/")[0];
      const id = VIEW_ALIASES[raw] || raw;
      if (!id || NAV.some(n => n.id === id)) setView(readView());
      setHash(window.location.hash);
      setMenuOpen(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  React.useEffect(() => {
    document.title = `${NAV.find(n => n.id === view)?.label || "Applications"} · College Forge`;
    window.scrollTo(0, 0);
    if (mainRef.current) mainRef.current.focus({ preventScroll: true });
  }, [view]);
  // "#settings/gptzero" scrolls to the element with that id once the view has rendered it.
  // "#shortlist/<slug>" is a school's page, "#timeline/<tab>" a tab and "#explore/<id>" a school, not anchors.
  React.useEffect(() => {
    const anchor = hash.slice(1).split("/")[1];
    if (!anchor || view === "shortlist" || view === "timeline" || view === "explore") return undefined;
    let tries = 0;
    let timer = 0;
    const seek = () => {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ block: "start" });
      else if (tries++ < 20) timer = setTimeout(seek, 50);
    };
    seek();
    return () => clearTimeout(timer);
  }, [view, hash, loading]);
  React.useEffect(() => {
    const escape = e => {
      if (e.key === "Escape") {
        if (menuOpen) menuButtonRef.current?.focus();
        setMenuOpen(false); setChatOpen(false);
      }
      if (e.key === "Tab" && menuOpen && sidebarRef.current) {
        const items = sidebarRef.current.querySelectorAll('a[href], button:not([disabled])');
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [menuOpen]);
  const navigate = id => {
    if (!NAV.some(n => n.id === id)) return;
    setView(id);
    setMenuOpen(false);
    if (window.location.hash !== "#" + id) window.location.hash = id;
  };
  const openChat = prompt => {
    const launcher = document.activeElement;
    chatReturnFocusRef.current = mobile && sidebarRef.current?.contains(launcher) ? menuButtonRef.current : launcher;
    setMenuOpen(false);
    if (typeof prompt === "string") setChatPrompt({ text: prompt, id: Date.now() });
    setChatOpen(true);
  };
  // Lets panels outside App's props (the interest log's interview prep) start a copilot chat.
  window.cfAsk = openChat;
  const runPlanInBackground = () => {
    if (typeof window.cfRunPlanSteps !== "function") return;
    setPlanTask({ state: "running", message: "Looking up deadlines and essay prompts…" });
    window.cfRunPlanSteps(message => setPlanTask({ state: "running", message }))
      .then(({ ws, failed }) => {
        applyWorkspace(ws);
        setPlanTask({ state: "done", message: failed.length
          ? `Deadlines and prompts added, except ${failed.join(", ")}. Rebuild from Settings to retry those.`
          : "Deadlines and essay prompts added." });
      })
      .catch(e => setPlanTask({ state: "error", message: e.message || "Couldn't look up deadlines and prompts. Try Rebuild in Settings." }));
  };
  const completeOnboarding = async (ws, options) => {
    if (ws) applyWorkspace(ws); else await refresh();
    reloadTracker();
    setRunOnboarding(false);
    navigate("shortlist");
    if (options && options.buildPlan) runPlanInBackground();
  };
  // "Dismiss" on the setup banner is remembered per workspace in this browser; Settings can still start setup.
  const setupBannerKey = "cf.setupBannerHidden." + (data?.draftStorageKey || "local");
  const [setupBannerHidden, setSetupBannerHidden] = React.useState(false);
  React.useEffect(() => {
    try { setSetupBannerHidden(localStorage.getItem(setupBannerKey) === "1"); } catch (e) { setSetupBannerHidden(false); }
  }, [setupBannerKey]);
  const hideSetupBanner = () => {
    setSetupBannerHidden(true);
    try { localStorage.setItem(setupBannerKey, "1"); } catch (e) {}
  };
  const hiddenDecisions = tracker.apps.filter(a => a.decision && a.decision.state === "hidden").length;
  const admits = tracker.apps.filter(a => a.stage === "admitted").length;
  const portalCount = tracker.apps.filter(a => a.stage !== "working" || (a.login && a.login.hasPassword)).length;
  if (loading) return <div className="cf-loading-screen" role="status"><span className="cf-loading-mark">✱</span>Opening your workspace…</div>;
  if (account && !account.signedIn) return <SignIn />;
  if (parentMode) return <ParentDashboard account={account} />;
  if (loadError) return <div className="cf-loading-screen"><div role="alert">{loadError}</div><Button onClick={refresh}>Try again</Button></div>;
  if (runOnboarding) return <OnboardingChat data={data} onComplete={completeOnboarding} onCancel={async () => { await refresh(); setRunOnboarding(false); }} />;

  return (
    <div className="cf-workspace" onClickCapture={e => {
      const a = e.target.closest && e.target.closest("a[href^='#']");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const id = a.getAttribute("href").slice(1);
      if (NAV.some(n => n.id === id)) { e.preventDefault(); navigate(id); }
    }}>
      <a className="cf-skip-link" href="#workspace-main">Skip to content</a>
      <header className="cf-mobile-bar">
        <a href={"#" + home} className="cf-brand"><span>✱</span>College Forge</a>
        <button ref={menuButtonRef} className="cf-icon-btn" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="workspace-sidebar" onClick={() => setMenuOpen(v => !v)}>{menuOpen ? "×" : "☰"}</button>
      </header>
      {menuOpen && <button className="cf-sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside ref={sidebarRef} aria-hidden={mobile && !menuOpen ? true : undefined} {...(mobile && !menuOpen ? { inert: "" } : {})} id="workspace-sidebar" className={"cf-sidebar" + (menuOpen ? " is-open" : "")}>
        <a href={"#" + home} className="cf-brand"><span aria-hidden="true">✱</span>College Forge</a>
        <div className="cf-workspace-label">A little clarity for what’s next.</div>
        <nav aria-label="Workspace">
          {NAV_GROUPS.map(group => <div className="cf-nav-group" key={group}>
            <div className="cf-nav-group-label">{group}</div>
            {NAV.filter(n => n.group === group && (view === n.id || ((!n.needsAdmit || admits > 0) && (!n.needsScattergrams || hasScattergrams)))).map(n => <a key={n.id} href={"#" + n.id} className="cf-nav-link" aria-current={view === n.id ? "page" : undefined}>
              <NavIcon name={n.icon} /><span>{n.label}</span>{n.id === "shortlist" && data.colleges.length > 0 && <span className="cf-nav-count">{data.colleges.length}</span>}{n.id === "applications" && portalCount > 0 && <span className="cf-nav-count">{portalCount}</span>}{n.id === "progress" && tracker.apps.length > 0 && <span className="cf-nav-count">{tracker.apps.length}</span>}{n.id === "decisions" && hiddenDecisions > 0 && <span className="cf-nav-count" style={{ background: "var(--coral)", color: "var(--on-primary)" }} aria-label={`${hiddenDecisions} new`}>{hiddenDecisions}</span>}
            </a>)}
            {PAGE_LINKS.filter(n => n.group === group).map(n => <a key={n.href} href={n.href} className="cf-nav-link"><NavIcon name={n.icon} /><span>{n.label}</span></a>)}
          </div>)}
        </nav>
        <div className="cf-sidebar-bottom">
          <button className="cf-copilot-launch" onClick={openChat}><span aria-hidden="true">✱</span><span>Talk it through<small>Your AI college copilot</small></span><span aria-hidden="true">↗</span></button>
          <div className="cf-sidebar-tools"><a href="/rankings">Our ranking methodology ↗</a><button className="cf-icon-btn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>{theme === "dark" ? "☀" : "☾"}</button></div>
        </div>
      </aside>
      <div className="cf-workspace-body">
        <div className="cf-workspace-topline"><span>MY COLLEGE WORKSPACE</span><span>{account && account.parent && account.parent.students > 0 ? <a href="/hub/index.html?view=parent" style={{ color: "inherit", marginRight: 14 }}>Parent dashboard</a> : null}{account && account.user ? account.user.email : data.applicant.cycle || "Your next chapter starts here"}</span></div>
        <main id="workspace-main" className="cf-hub-main" ref={mainRef} tabIndex={-1}>
          {!data.onboarding?.completed && !setupBannerHidden && <div className="cf-setup-banner" role="note" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "24px 0 0", padding: "12px 16px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--surface-soft)", color: "var(--body)", fontSize: 14 }}>
            <span>Setup isn't finished. Answer a few questions to get a starting college list.</span>
            <span style={{ display: "flex", gap: 8 }}>
              <Button size="sm" variant="secondary" onClick={hideSetupBanner}>Dismiss</Button>
              <Button size="sm" onClick={() => setRunOnboarding(true)}>Finish setup</Button>
            </span>
          </div>}
          {view === "applications" && <Applications data={data} tracker={tracker} onTrackerChange={setTrackerAndList} onWorkspaceChange={applyWorkspace} />}
          {view === "progress" && <Progress data={data} tracker={tracker} onTrackerChange={setTrackerAndList} onWorkspaceChange={applyWorkspaceAndTracker} />}
          {view === "timeline" && <Timeline data={data} tracker={tracker} hash={hash} onWorkspaceChange={applyWorkspace} />}
          {view === "decisions" && <Decisions tracker={tracker} onTrackerChange={setTracker} onWorkspaceChange={refresh} />}
          {view === "board" && <DecisionBoard tracker={tracker} onTrackerChange={setTracker} />}
          {view === "list" && <RankList tracker={tracker} data={data} onWorkspaceChange={applyWorkspace} />}
          {view === "official" && <OfficialRankings data={data} onWorkspaceChange={refresh} />}
          {view === "profile" && <Profile data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "recommendations" && <Recommendations data={data} onAsk={openChat} onNavigate={navigate} onWorkspaceChange={applyWorkspaceAndTracker} onStartSetup={() => setRunOnboarding(true)} />}
          {view === "explore" && <Explore data={data} onWorkspaceChange={refresh} />}
          {view === "scattergrams" && <Scattergrams data={data} />}
          {view === "shortlist" && <Shortlist data={data} tracker={tracker} detailSlug={window.cfSchoolDetail.slugFromHash(hash)} onTrackerChange={setTrackerAndList} onAsk={openChat} onWorkspaceChange={applyWorkspaceAndTracker} />}
          {view === "essays" && <Essays data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "track" && <Track data={data} tracker={tracker} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "share" && <ShareExport data={data} onWorkspaceChange={applyWorkspace} onWorkspaceSwitch={switchWorkspace} />}
          {view === "settings" && <Settings theme={theme} account={account} onToggleTheme={toggleTheme} onStartOnboarding={() => setRunOnboarding(true)} onWorkspaceChange={switchWorkspace} />}
        </main>
        <footer className="cf-workspace-footer"><span>College Forge · Room to find your own path.</span><a href="/rankings">Explore the data ↗</a></footer>
      </div>
      {/* Stays mounted while hidden so closing the chat can return focus here. */}
      <button type="button" className="cf-fab cf-chat-fab" hidden={chatOpen || menuOpen} aria-label="Open AI copilot chat" onClick={openChat}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
      </button>
      {planTask && <div className="cf-plan-pill" role="status" style={{ position: "fixed", left: 16, bottom: 16, zIndex: 55, maxWidth: "min(420px, calc(100vw - 96px))", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 16, border: "1px solid var(--hairline)", background: "var(--canvas)", color: planTask.state === "error" ? "var(--error)" : "var(--body)", fontSize: 13, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
        {planTask.state === "running" ? <span className="cf-onboard-spinner" aria-hidden="true" /> : <span aria-hidden="true">{planTask.state === "done" ? "✓" : "!"}</span>}
        <span style={{ minWidth: 0, lineHeight: 1.4 }}>{planTask.message}</span>
        {planTask.state !== "running" && <button type="button" className="cf-icon-btn" aria-label="Dismiss" onClick={() => setPlanTask(null)}>×</button>}
      </div>}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 60 }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <AiChat returnFocusRef={chatReturnFocusRef} key={data.draftStorageKey || "initial"} open={chatOpen} initialPrompt={chatPrompt} onClose={() => setChatOpen(false)} onWorkspaceChange={refresh} data={data} view={view} />
        </div>
      </div>
    </div>
  );
}
window.App = App;
