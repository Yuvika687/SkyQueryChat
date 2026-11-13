import type { MetadataRoute } from "next";
import { CITY_SLUGS } from "@/lib/pages-api";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sky-query-chat.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/explore", "/ask", "/compare", ...CITY_SLUGS.map((s) => `/city/${s}`)];
  return pages.map((p) => ({ url: `${SITE}${p}`, changeFrequency: "daily", priority: p === "" ? 1 : 0.7 }));
}
