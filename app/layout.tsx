import type { ReactNode } from "react";

export const metadata = {
  title: "College Forge",
  description: "Your AI-powered college applications hub.",
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
