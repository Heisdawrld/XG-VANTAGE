/** Root layout — xG-Vantage Premium Football Intelligence */
import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "xG-Vantage — Football Intelligence",
  description: "AI-powered football match predictions, live scores, stats, and betting intelligence.",
  manifest: "/manifest.json",
  icons: { apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#060a0e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grosk:wght@500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans antialiased bg-[#060a0e] text-white`}>
        {children}
        <div className="noise-overlay" />
      </body>
    </html>
  );
}
