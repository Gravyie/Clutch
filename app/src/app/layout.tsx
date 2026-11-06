import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Bricolage_Grotesque } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", axes: ["opsz", "wdth"] });

export const metadata: Metadata = {
  title: { default: "Clutch · Every moment is a market", template: "%s · Clutch" },
  description: "Live markets on the moments of a stream. Opened by AI, settled by two independent sources, with a public receipt for every result.",
  openGraph: { title: "Clutch", description: "Every moment is a market.", type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070709" },
    { media: "(prefers-color-scheme: light)", color: "#f6f6f7" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${display.variable} dark`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
