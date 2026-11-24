import type { MetadataRoute } from "next";

const BASE =
  process.env.SITE_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE.replace(/\/$/, ""),
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
