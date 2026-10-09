import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import "./fonts.css";
import "./globals.css";

import { Providers } from "@/components/console/providers";

export const metadata: Metadata = {
  title: "MeshSync Console",
  description:
    "Live control deck for the MeshSync peer-to-peer local-first file synchronization mesh.",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
