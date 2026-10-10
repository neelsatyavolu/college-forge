import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://forge.n3el.dev"),
  title: "College Forge",
  description: "Your AI-powered college applications hub.",
  // The card image comes from app/opengraph-image.png. These fields describe the landing page.
  openGraph: {
    title: "College Forge · Plan your college applications",
    description:
      "A free workspace for your college applications: a list built on graduate outcomes, essays against the real prompts, and every deadline on one timeline.",
    url: "/",
    siteName: "College Forge",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body style={{ margin: 0 }} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
