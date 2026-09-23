const { Button } = window.CollegeForgeDesignSystem_e95e63;
const Onboarding = window.Onboarding;

const NAV = [
  { id: "overview", label: "Overview", group: "Your workspace", icon: "home" },
  { id: "profile", label: "Your profile", group: "Your workspace", icon: "user" },
  { id: "recommendations", label: "Colleges for you", group: "Discover", icon: "spark" },
  { id: "explore", label: "Explore colleges", group: "Discover", icon: "search" },
  { id: "shortlist", label: "Your shortlist", group: "Discover", icon: "bookmark" },
  { id: "compare", label: "Compare schools", group: "Discover", icon: "columns" },
  { id: "essays", label: "Essays", group: "Apply", icon: "edit" },
  { id: "planner", label: "Application plan", group: "Apply", icon: "check" },
  { id: "timeline", label: "Dates & deadlines", group: "Apply", icon: "calendar" },
  { id: "track", label: "Letters & aid", group: "Apply", icon: "folder" },
  { id: "share", label: "Share & export", group: "Workspace", icon: "share" },
  { id: "settings", label: "Settings", group: "Workspace", icon: "settings" },
];
// Full pages outside the hash-routed workspace views.
const PAGE_LINKS = [{ href: "/rankings", label: "Career rankings", group: "Discover", icon: "chart" }];

function NavIcon({ name }) {
  const paths = {
    home: "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9",
    user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2",
    spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
    search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0m-2 5 6 6",
    chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
    bookmark: "M6 3h12v18l-6-4-6 4Z",
    columns: "M3 4h7v16H3ZM14 4h7v16h-7Z",
    edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14ZM13 21h8",
    check: "m4 6 2 2 4-4M13 6h7M4 13l2 2 4-4M13 13h7M4 20h16",
    calendar: "M4 5h16v16H4ZM8 2v6m8-6v6M4 11h16",
    folder: "M3 6h7l2 3h9v12H3Z",
    share: "M12 16V3m-4 4 4-4 4 4M5 12H3v9h18v-9h-2",
    settings: "M3 6h18M3 12h18M3 18h18M8 3v6m8 0v6m-8 0v6",
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.home} /></svg>;
}

function loadFavorites() {
  try { const values = JSON.parse(localStorage.getItem("cf.favorites") || "[]"); return Array.isArray(values) ? values : []; } catch (e) { return []; }
}
function readView() {
  const h = window.location.hash.slice(1);
  return NAV.some(n => n.id === h) ? h : "overview";
}

function App() {
  const [data, setData] = React.useState(window.CF_DATA);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [view, setView] = React.useState(readView);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatPrompt, setChatPrompt] = React.useState(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [mobile, setMobile] = React.useState(() => window.matchMedia("(max-width: 850px)").matches);
  const sidebarRef = React.useRef(null);
  const menuButtonRef = React.useRef(null);
  const chatReturnFocusRef = React.useRef(null);
  const [favorites, setFavorites] = React.useState(loadFavorites);
  const [theme, setTheme] = React.useState(() => document.documentElement.getAttribute("data-theme") || "light");
  const [runOnboarding, setRunOnboarding] = React.useState(false);
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
  const switchWorkspace = React.useCallback(ws => {
    setChatOpen(false);
    setChatPrompt(null);
    applyWorkspace(ws, true);
  }, [applyWorkspace]);
  const refresh = React.useCallback(async () => {
    const requestedScope = window.CF_DATA?.draftStorageKey;
    try {
      const ws = await window.cfApi.getWorkspace();
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
  React.useEffect(() => { setChatOpen(false); setChatPrompt(null); }, [data?.draftStorageKey]);
  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 850px)");
    const change = () => { setMobile(media.matches); setMenuOpen(false); };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  React.useEffect(() => {
    if (menuOpen && sidebarRef.current) sidebarRef.current.querySelector('[aria-current="page"]').focus();
  }, [menuOpen]);
  React.useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.slice(1);
      if (!id || NAV.some(n => n.id === id)) setView(readView());
      setMenuOpen(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  React.useEffect(() => {
    document.title = `${NAV.find(n => n.id === view)?.label || "Overview"} · College Forge`;
    window.scrollTo(0, 0);
    if (mainRef.current) mainRef.current.focus({ preventScroll: true });
  }, [view]);
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
  const toggleFav = slug => setFavorites(f => {
    const next = f.includes(slug) ? f.filter(s => s !== slug) : [...f, slug];
    try { localStorage.setItem("cf.favorites", JSON.stringify(next)); } catch (e) {}
    return next;
  });
  const openChat = prompt => {
    const launcher = document.activeElement;
    chatReturnFocusRef.current = mobile && sidebarRef.current?.contains(launcher) ? menuButtonRef.current : launcher;
    setMenuOpen(false);
    if (typeof prompt === "string") setChatPrompt({ text: prompt, id: Date.now() });
    setChatOpen(true);
  };
  const completeOnboarding = async ws => {
    if (ws) applyWorkspace(ws); else await refresh();
    setRunOnboarding(false);
    navigate("shortlist");
  };
  if (loading) return <div className="cf-loading-screen" role="status"><span className="cf-loading-mark">✱</span>Opening your workspace…</div>;
  if (loadError) return <div className="cf-loading-screen"><div role="alert">{loadError}</div><Button onClick={refresh}>Try again</Button></div>;
  if (runOnboarding) return <Onboarding data={data} onComplete={completeOnboarding} onCancel={async () => { await refresh(); setRunOnboarding(false); }} />;

  return (
    <div className="cf-workspace" onClickCapture={e => {
      const a = e.target.closest && e.target.closest("a[href^='#']");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const id = a.getAttribute("href").slice(1);
      if (NAV.some(n => n.id === id)) { e.preventDefault(); navigate(id); }
    }}>
      <a className="cf-skip-link" href="#workspace-main">Skip to content</a>
      <header className="cf-mobile-bar">
        <a href="#overview" className="cf-brand"><span>✱</span>College Forge</a>
        <button ref={menuButtonRef} className="cf-icon-btn" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="workspace-sidebar" onClick={() => setMenuOpen(v => !v)}>{menuOpen ? "×" : "☰"}</button>
      </header>
      {menuOpen && <button className="cf-sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside ref={sidebarRef} aria-hidden={mobile && !menuOpen ? true : undefined} {...(mobile && !menuOpen ? { inert: "" } : {})} id="workspace-sidebar" className={"cf-sidebar" + (menuOpen ? " is-open" : "")}>
        <a href="#overview" className="cf-brand"><span aria-hidden="true">✱</span>College Forge</a>
        <div className="cf-workspace-label">A little clarity for what’s next.</div>
        <nav aria-label="Workspace">
          {["Your workspace", "Discover", "Apply", "Workspace"].map(group => <div className="cf-nav-group" key={group}>
            <div className="cf-nav-group-label">{group}</div>
            {NAV.filter(n => n.group === group).map(n => <a key={n.id} href={"#" + n.id} className="cf-nav-link" aria-current={view === n.id ? "page" : undefined}>
              <NavIcon name={n.icon} /><span>{n.label}</span>{n.id === "shortlist" && data.colleges.length > 0 && <span className="cf-nav-count">{data.colleges.length}</span>}
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
        <div className="cf-workspace-topline"><span>MY COLLEGE WORKSPACE</span><span>{data.applicant.cycle || "Your next chapter starts here"}</span></div>
        <main id="workspace-main" className="cf-hub-main" ref={mainRef} tabIndex={-1}>
          {view === "overview" && <Overview data={data} onNavigate={navigate} onAsk={openChat} onStart={() => setRunOnboarding(true)} />}
          {view === "profile" && <Profile data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "recommendations" && <Recommendations data={data} onAsk={openChat} onNavigate={navigate} onWorkspaceChange={applyWorkspace} />}
          {view === "explore" && <Explore data={data} favorites={favorites} onToggleFavorite={toggleFav} onWorkspaceChange={refresh} />}
          {view === "shortlist" && <Shortlist data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "essays" && <Essays data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "planner" && <Planner data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "timeline" && <Timeline data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "track" && <Track data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "compare" && <Compare data={data} onAsk={openChat} />}
          {view === "share" && <ShareExport data={data} onWorkspaceChange={applyWorkspace} onWorkspaceSwitch={switchWorkspace} />}
          {view === "settings" && <Settings theme={theme} onToggleTheme={toggleTheme} onStartOnboarding={() => setRunOnboarding(true)} onWorkspaceChange={switchWorkspace} />}
        </main>
        <footer className="cf-workspace-footer"><span>College Forge · Room to find your own path.</span><a href="/rankings">Explore the data ↗</a></footer>
      </div>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 60 }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <AiChat returnFocusRef={chatReturnFocusRef} key={data.draftStorageKey || "initial"} open={chatOpen} initialPrompt={chatPrompt} onClose={() => setChatOpen(false)} onWorkspaceChange={refresh} data={data} view={view} />
        </div>
      </div>
    </div>
  );
}
window.App = App;
