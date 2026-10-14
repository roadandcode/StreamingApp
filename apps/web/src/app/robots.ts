import type { MetadataRoute } from "next";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Index the catalog and content pages; keep account, checkout, player and auth pages out. */
export default function robots(): MetadataRoute.Robots {
  const { siteUrl } = getConfig();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/content/"],
        disallow: ["/account", "/subscribe", "/watch/", "/device", "/login", "/register", "/api/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
