// OWNER: D3.  Root shell — fonts, metadata, and the dark class the whole
// design system hangs off.  See app/globals.css for the palette.
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
  colorScheme: "dark",
  themeColor: "#1b2740",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `dark` is permanent: DealFlow360 ships one theme.  It is required here
    // rather than merely cosmetic — components/ui/** relies on `dark:`
    // variants, and globals.css scopes that variant to descendants of .dark.
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
