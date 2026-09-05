// OWNER: D3.  Root shell — fonts, metadata, and the theme class the whole
// design system hangs off.  See app/globals.css for the palette.
//
// MERGE NOTE (D3 + D4): light/dark landed twice — D4 shipped next-themes on
// main while this branch carried a hand-rolled pre-paint script.  D4's is the
// one kept: next-themes already handles the no-flash inline script, the
// system-preference query, storage and cross-tab sync, and it is an existing
// dependency rather than a new one.  What survives from this branch is the
// PALETTE in app/globals.css, not the mechanism.
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DealFlow360",
  description: "Self-governing B2B sales operations platform",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  // ONE value, not a light/dark pair: --nav is the same plum in both palettes,
  // so the mobile browser chrome continues the bar either way.
  themeColor: "#5e3a54",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes writes the resolved class onto
    // <html> before hydration, which React would otherwise report as a
    // mismatch.  Scoped to this element only.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground transition-colors duration-200">
        {/* defaultTheme="system" rather than "dark": with enableSystem set, a
            hardcoded default only applies to visitors whose OS expresses no
            preference, and silently overriding everyone else is the behaviour
            the toggle exists to avoid. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
