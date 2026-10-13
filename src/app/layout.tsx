import type { Metadata, Viewport } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import Script from "next/script";
import { PwaRegister } from "@/components/public/pwa-register";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, siteUrl } from "@/lib/public-site/config";
import "./globals.css";

const playfair = Playfair_Display({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

// Pages set their own title, description, canonical and indexing through pageMetadata(); these are the site-wide defaults and the
// base that relative canonical / Open Graph URLs resolve against.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} — ${SITE_TAGLINE}`, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#7a0f31" },
    { media: "(prefers-color-scheme: dark)", color: "#16100f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${playfair.variable} ${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Catches the browser's install event as early as possible so the install offer can appear on the first page (see InstallPrompt). */}
        <Script id="lpp-install-capture" strategy="beforeInteractive">{`window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__lppInstall=e;window.dispatchEvent(new Event("lpp-install-ready"));});`}</Script>
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-body">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
