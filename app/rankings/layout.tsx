import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Career rankings · College Forge",
  description:
    "A historical comparison of U.S. colleges' graduate outcomes: earnings compared with the same major elsewhere, plus graduation and employment. No direct weight on selectivity.",
  openGraph: {
    title: "Where graduates did best · College Forge",
    description: "College and major rankings built on outcomes, not prestige.",
  },
};

// Same bootstrap as public/hub/index.html so the saved theme applies before first paint.
const THEME_BOOTSTRAP = `(function(){try{var s=localStorage.getItem("cf.theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme",d?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export default function RankingsLayout({ children }: { children: ReactNode }) {
  // Shares the hub's stylesheets (the hub is static and bypasses this layout).
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
      />
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/styles.css" />
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/hub/workspace.css" />
      {children}
    </>
  );
}
