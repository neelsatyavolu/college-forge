import type { ReactNode } from "react";
import type { Metadata } from "next";
import { THEME_BOOTSTRAP } from "@/lib/theme-bootstrap";

export const metadata: Metadata = {
  title: "Career rankings · College Forge",
  description:
    "Colleges ranked on how well set up you'd be for a career in the majors you can reach: pay, top earners, employer pull, jobs and campus life. Cost never counts.",
  openGraph: {
    title: "Where you'd be set up best · College Forge",
    description: "College rankings built on the majors you can reach. Cost never counts.",
  },
};

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
