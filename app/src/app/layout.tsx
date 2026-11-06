import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Newsreader } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

/** Editorial serif for landing-page headlines only; the product UI stays on Geist. */
const serif = Newsreader({ subsets: ["latin"], variable: "--font-serif", axes: ["opsz"], style: ["normal", "italic"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Clutch · Every moment is a market", template: "%s · Clutch" },
  description: "Live markets on the moments of a stream. Opened by AI, settled by a rule committed before trading, with a public receipt for every result.",
  openGraph: { title: "Clutch", description: "Every moment is a market.", type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#131211" },
    { media: "(prefers-color-scheme: light)", color: "#f2f1ec" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${serif.variable} dark`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
