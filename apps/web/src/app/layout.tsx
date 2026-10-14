import type { Metadata, Viewport } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { getConfig } from "@/lib/config";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/format";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { siteUrl } = getConfig();
  return {
    metadataBase: new URL(siteUrl),
    title: { default: `${SITE_NAME} – ${SITE_TAGLINE}`, template: `%s | ${SITE_NAME}` },
    description:
      "Watch original courses and videos from Indian creators. Start with free lessons, subscribe to unlock everything on the web and on Android.",
    applicationName: SITE_NAME,
    openGraph: { siteName: SITE_NAME, type: "website", locale: "en_IN" },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = {
  themeColor: "#0a0c11",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <a className="visually-hidden" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
