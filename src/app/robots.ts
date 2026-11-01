import type { MetadataRoute } from "next";

/** robots: публичные страницы открыты, внутренние экраны закрыты. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/dispatch", "/driver", "/finance", "/admin", "/order", "/api", "/login", "/register", "/verify"],
    },
    sitemap: "https://umzug-seven.vercel.app/sitemap.xml",
  };
}
