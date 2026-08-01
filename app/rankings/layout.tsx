import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Purchasing-Power Rankings — College Forge",
  description:
    "U.S. colleges ranked by what a graduate’s earnings are actually worth where they live, blended with an objective reputation measure.",
  openGraph: {
    title: "Purchasing-Power College Rankings",
    description:
      "What a degree is worth where graduates actually live — not near campus, and not just prestige.",
  },
};

export default function RankingsLayout({ children }: { children: ReactNode }) {
  // Fonts + global tokens load from public/ (hub is static and bypasses this layout).
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font, @next/next/no-css-tags */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font, @next/next/no-css-tags */}
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font, @next/next/no-css-tags */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
      />
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/styles.css" />
      {children}
    </>
  );
}
