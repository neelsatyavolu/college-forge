const { Button } = window.CollegeForgeDesignSystem_e95e63;
const Onboarding = window.Onboarding;

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "profile", label: "Profile" },
  { id: "explore", label: "Explore" },
  { id: "shortlist", label: "Shortlist" },
  { id: "essays", label: "Essays" },
  { id: "planner", label: "Planner" },
  { id: "timeline", label: "Timeline" },
  { id: "track", label: "Track" },
  { id: "compare", label: "Compare" },
  { id: "share", label: "Share" },
  { id: "settings", label: "Settings" },
];

function loadFavorites() {
  try { return JSON.parse(localStorage.getItem("cf.favorites") || "[]"); } catch (e) { return []; }
}

function isOnboardingComplete(data) {
  return Boolean(data && data.onboarding && data.onboarding.completed);
}

function loadOnboardBannerDismissed() {
  try { return localStorage.getItem("cf.onboard.dismissed") === "1"; } catch (e) { return false; }
}

function persistOnboardBannerDismissed() {
  try { localStorage.setItem("cf.onboard.dismissed", "1"); } catch (e) {}
}

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function ThemeToggle({ theme, onToggle }) {
  const dark = theme === "dark";
  return (
    <button type="button" onClick={onToggle} className="cf-icon-btn cf-press"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}>
      {dark ? "☀" : "☾"}
    </button>
  );
}

function HubNav({ view, theme, onToggleTheme, onOpenChat, onNavigate }) {
  const tabs = (
    <ul className="cf-hub-nav__tabs" role="list">
      {NAV.map((n) => (
        <li key={n.id}>
          <a href={"#" + n.id} className="cf-hub-nav__tab"
            aria-current={view === n.id ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(n.id);
              if (e.currentTarget.blur) e.currentTarget.blur();
            }}>
            {n.label}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <header className="cf-hub-nav">
      <div className="cf-hub-nav__row">
        <a href="#overview" className="cf-hub-nav__brand"
          onClick={(e) => { e.preventDefault(); onNavigate("overview"); }}>
          <span aria-hidden className="cf-hub-nav__mark">✱</span>
          <span className="cf-hub-nav__word">College Forge</span>
        </a>
        {tabs}
        <div className="cf-hub-nav__right">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <Button size="sm" variant="secondary" onClick={onOpenChat} className="cf-press">Copilot ✱</Button>
        </div>
      </div>
      <div className="cf-hub-nav__scroller" aria-label="Sections">
        <ul role="list">
          {NAV.map((n) => (
            <li key={n.id}>
              <a href={"#" + n.id} className="cf-hub-nav__tab"
                aria-current={view === n.id ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(n.id);
                  if (e.currentTarget.blur) e.currentTarget.blur();
                }}>
                {n.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

function App() {
  const [data, setData] = React.useState(window.CF_DATA);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState(() => {
    const h = (window.location.hash || "").replace(/^#/, "");
    return NAV.some((n) => n.id === h) ? h : "overview";
  });
  const [chatOpen, setChatOpen] = React.useState(false);
  const [favorites, setFavorites] = React.useState(loadFavorites);
  const [theme, setTheme] = React.useState(currentTheme);
  const [showOnboardBanner, setShowOnboardBanner] = React.useState(() => !loadOnboardBannerDismissed());
  const [runOnboarding, setRunOnboarding] = React.useState(false);

  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("cf.theme", next); } catch (e) {}
      return next;
    });
  };

  const applyWorkspace = React.useCallback((ws) => {
    if (!ws) return;
    window.CF_DATA = ws;
    setData(ws);
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/workspace", { credentials: "same-origin" });
      if (res.ok) {
        const ws = await res.json();
        applyWorkspace(ws);
      }
    } catch (e) { /* keep last data */ }
    setLoading(false);
  }, [applyWorkspace]);

  React.useEffect(() => { refresh(); }, [refresh]);

  React.useEffect(() => {
    const onHash = () => {
      const h = (window.location.hash || "").replace(/^#/, "");
      if (NAV.some((n) => n.id === h)) setView(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (id) => {
    setView(id);
    try { window.history.replaceState(null, "", "#" + id); } catch (e) {}
  };

  const toggleFav = (slug) =>
    setFavorites((f) => {
      const next = f.includes(slug) ? f.filter((s) => s !== slug) : [...f, slug];
      try { localStorage.setItem("cf.favorites", JSON.stringify(next)); } catch (e) {}
      return next;
    });

  const openChat = () => setChatOpen(true);

  const dismissOnboardBanner = () => {
    setShowOnboardBanner(false);
    persistOnboardBannerDismissed();
  };

  const handleOnboardComplete = React.useCallback(async (ws) => {
    if (ws) applyWorkspace(ws);
    else await refresh();
    setRunOnboarding(false);
    setShowOnboardBanner(false);
    persistOnboardBannerDismissed();
    // Land on Shortlist so the student sees the built college list first.
    setView("shortlist");
    try { window.history.replaceState(null, "", "#shortlist"); } catch (e) {}
  }, [applyWorkspace, refresh]);

  const startOnboarding = React.useCallback(() => {
    try { localStorage.removeItem("cf.onboard.dismissed"); } catch (e) {}
    setShowOnboardBanner(true);
    setRunOnboarding(true);
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--canvas)", color: "var(--muted)", fontSize: 14 }}>
        Loading your hub…
      </div>
    );
  }

  if (runOnboarding) {
    return <Onboarding data={data} onComplete={handleOnboardComplete} />;
  }

  const showGetStarted = !isOnboardingComplete(data) && showOnboardBanner;

  return (
    <div style={{ position: "relative", minHeight: "100%", background: "var(--canvas)" }}
      onClickCapture={(e) => {
        const a = e.target.closest && e.target.closest("a[href^='#']");
        if (!a) return;
        const id = a.getAttribute("href").slice(1);
        if (!NAV.some((n) => n.id === id)) return;
        e.preventDefault();
        navigate(id);
        if (a.blur) a.blur();
      }}>
      <HubNav view={view} theme={theme} onToggleTheme={toggleTheme}
        onOpenChat={openChat} onNavigate={navigate} />

      <div>
        <div className="cf-hub-main" style={{ maxWidth: "var(--max-content)", margin: "0 auto", padding: "0 var(--page-gutter) 80px" }}>
          {showGetStarted ? (
            <div style={{
              marginTop: 32,
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--hairline)",
              background: "var(--surface-card)",
              padding: "24px 28px",
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--coral)", marginBottom: 8 }}>
                Get started
              </div>
              <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: "clamp(22px, 3vw, 28px)", letterSpacing: "-0.4px", color: "var(--ink)", textWrap: "balance" }}>
                Set up your applications hub
              </h2>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--body)", maxWidth: 640, textWrap: "pretty" }}>
                Connect an AI for the copilot, enter your basics and academics, pick a few schools, and optionally upload a transcript or resume. The full hub unlocks when you’re done — you can edit anything later.
              </p>
              <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button onClick={() => setRunOnboarding(true)}>Start onboarding</Button>
                <Button variant="secondary" onClick={dismissOnboardBanner}>Dismiss</Button>
              </div>
            </div>
          ) : null}

          {view === "overview" && <Overview data={data} onNavigate={navigate} onAsk={openChat} />}
          {view === "profile" && <Profile data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "explore" && <Explore data={data} favorites={favorites} onToggleFavorite={toggleFav} onWorkspaceChange={refresh} />}
          {view === "essays" && <Essays data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "shortlist" && <Shortlist data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "planner" && <Planner data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "timeline" && <Timeline data={data} onAsk={openChat} />}
          {view === "track" && <Track data={data} onAsk={openChat} onWorkspaceChange={applyWorkspace} />}
          {view === "compare" && <Compare data={data} onAsk={openChat} />}
          {view === "share" && <ShareExport data={data} onWorkspaceChange={applyWorkspace} />}
          {view === "settings" && (
            <Settings
              theme={theme}
              onToggleTheme={toggleTheme}
              onStartOnboarding={startOnboarding}
              onWorkspaceChange={applyWorkspace}
            />
          )}
        </div>
      </div>

      <footer style={{ background: "var(--surface-dark)", color: "var(--on-dark-soft)", marginTop: 0 }}>
        <div style={{ maxWidth: "var(--max-content)", margin: "0 auto", padding: "40px var(--page-gutter)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span aria-hidden style={{ color: "var(--coral)", fontSize: 22, lineHeight: 1 }}>✱</span>
            <span className="cf-display" style={{ fontSize: 22, color: "var(--on-dark)" }}>College Forge</span>
          </div>
          <p style={{ fontSize: 14, maxWidth: 520, margin: "0 0 8px", lineHeight: 1.55, textWrap: "pretty" }}>
            Free college planning hub — research, profile, essays, deadlines, advisor share, and Common App–ready exports. Upload once; the copilot keeps the hub current.
          </p>
          {data && data.applicant && data.applicant.cycle ? (
            <p style={{ fontSize: 13, marginTop: 20, color: "var(--on-dark-soft)" }}>Cycle: {data.applicant.cycle}</p>
          ) : null}
        </div>
      </footer>

      {!chatOpen ? (
        <button type="button" onClick={openChat} aria-label="Open copilot" className="cf-fab cf-press">✱</button>
      ) : null}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 50 }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: chatOpen ? "auto" : "none" }}>
          <AiChat open={chatOpen} onClose={() => setChatOpen(false)} onWorkspaceChange={refresh} />
        </div>
      </div>
    </div>
  );
}
window.App = App;
