import type { MetadataRoute } from "next";

const BASE = "https://umzug-seven.vercel.app";

/** SEO-минимум (Э8): публичные страницы в sitemap; внутренние экраны — нет. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/impressum", "/datenschutz", "/agb", "/widerruf"];
  return pages.map((p) => ({
    url: `${BASE}${p || "/"}`,
    lastModified: new Date(),
    changeFrequency: p === "" ? "weekly" : "yearly",
    priority: p === "" ? 1 : 0.5,
  }));
}
