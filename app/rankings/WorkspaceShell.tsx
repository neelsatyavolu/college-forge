import { useEffect, useRef, useState, type ReactNode } from "react";

// Mirrors public/hub/App.jsx NAV so the rankings page reads as part of the workspace.
const NAV = [
  { href: "/hub/index.html#overview", label: "Overview", group: "Your workspace", icon: "home" },
  { href: "/hub/index.html#profile", label: "Your profile", group: "Your workspace", icon: "user" },
  { href: "/hub/index.html#recommendations", label: "Colleges for you", group: "Discover", icon: "spark" },
  { href: "/hub/index.html#explore", label: "Explore colleges", group: "Discover", icon: "search" },
  { href: "/hub/index.html#shortlist", label: "Your shortlist", group: "Discover", icon: "bookmark" },
  { href: "/hub/index.html#compare", label: "Compare schools", group: "Discover", icon: "columns" },
  { href: "/rankings", label: "Career rankings", group: "Discover", icon: "chart", current: true },
  { href: "/hub/index.html#essays", label: "Essays", group: "Apply", icon: "edit" },
  { href: "/hub/index.html#planner", label: "Application plan", group: "Apply", icon: "check" },
  { href: "/hub/index.html#timeline", label: "Dates & deadlines", group: "Apply", icon: "calendar" },
  { href: "/hub/index.html#track", label: "Letters & aid", group: "Apply", icon: "folder" },
  { href: "/hub/index.html#share", label: "Share & export", group: "Workspace", icon: "share" },
  { href: "/hub/index.html#settings", label: "Settings", group: "Workspace", icon: "settings" },
];
const GROUPS = ["Your workspace", "Discover", "Apply", "Workspace"];

const ICONS: Record<string, string> = {
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

function NavIcon({ name }: { name: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.home} />
    </svg>
  );
}

type Props = { theme: string; onToggleTheme: () => void; topline: string; children: ReactNode };

export default function WorkspaceShell({ theme, onToggleTheme, topline, children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 850px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const hidden = mobile && !menuOpen;
  // React 18 has no `inert` prop; set the attribute directly so a closed drawer is not tabbable.
  useEffect(() => {
    sidebarRef.current?.toggleAttribute("inert", hidden);
  }, [hidden]);

  return (
    <div className="cf-workspace">
      <a className="cf-skip-link" href="#rankings-main">Skip to content</a>
      <header className="cf-mobile-bar">
        <a href="/hub/index.html#overview" className="cf-brand"><span aria-hidden="true">✱</span>College Forge</a>
        <button
          className="cf-icon-btn"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          aria-controls="workspace-sidebar"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? "×" : "☰"}
        </button>
      </header>
      {menuOpen && <button className="cf-sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside
        id="workspace-sidebar"
        className={"cf-sidebar" + (menuOpen ? " is-open" : "")}
        ref={sidebarRef}
        aria-hidden={hidden || undefined}
      >
        <a href="/hub/index.html#overview" className="cf-brand"><span aria-hidden="true">✱</span>College Forge</a>
        <div className="cf-workspace-label">A little clarity for what’s next.</div>
        <nav aria-label="Workspace">
          {GROUPS.map((group) => (
            <div className="cf-nav-group" key={group}>
              <div className="cf-nav-group-label">{group}</div>
              {NAV.filter((n) => n.group === group).map((n) => (
                <a key={n.href} href={n.href} className="cf-nav-link" aria-current={n.current ? "page" : undefined}>
                  <NavIcon name={n.icon} />
                  <span>{n.label}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="cf-sidebar-bottom">
          <div className="cf-sidebar-tools">
            <a href="#methodology" onClick={() => setMenuOpen(false)}>How the ranking works</a>
            <button className="cf-icon-btn" onClick={onToggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
        </div>
      </aside>
      <div className="cf-workspace-body">
        <div className="cf-workspace-topline">
          <span>CAREER RANKINGS</span>
          <span>{topline}</span>
        </div>
        <main id="rankings-main" className="cf-hub-main" tabIndex={-1}>{children}</main>
        <footer className="cf-workspace-footer">
          <span>College Forge · Room to find your own path.</span>
          <a href="/data/rankings/sources.md">Data sources ↗</a>
        </footer>
      </div>
    </div>
  );
}
