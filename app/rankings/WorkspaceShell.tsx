import { useEffect, useRef, useState, type ReactNode } from "react";
import cfNav from "@/public/hub/nav.js";

// The hub's own sidebar list (public/hub/nav.js), so this page always shows the same tabs as the workspace.
const NAV = [
  ...cfNav.NAV.map((n) => ({ href: `/hub/index.html#${n.id}`, label: n.label, group: n.group, icon: n.icon, current: false })),
  ...cfNav.PAGE_LINKS.map((n) => ({ ...n, current: n.href === "/rankings" })),
];
const GROUPS = cfNav.GROUPS;
const ICONS: Record<string, string> = cfNav.ICONS;

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
        <a href="/hub/index.html#applications" className="cf-brand"><span aria-hidden="true">✱</span>College Forge</a>
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
        <a href="/hub/index.html#applications" className="cf-brand"><span aria-hidden="true">✱</span>College Forge</a>
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
          <a href="#methodology">Data sources</a>
        </footer>
      </div>
    </div>
  );
}
