import type { MetadataRoute } from "next";
import { ROUTES } from "@/lib/routes";
import { absoluteUrl } from "@/lib/seo";

const HOME_PRIORITY = 1;
const SIGN_UP_PRIORITY = 0.8;
const LEGAL_PRIORITY = 0.3;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: absoluteUrl(ROUTES.home),
      lastModified,
      changeFrequency: "weekly",
      priority: HOME_PRIORITY,
    },
    {
      url: absoluteUrl(ROUTES.signUp),
      lastModified,
      changeFrequency: "monthly",
      priority: SIGN_UP_PRIORITY,
    },
    {
      url: absoluteUrl(ROUTES.privacy),
      lastModified,
      changeFrequency: "yearly",
      priority: LEGAL_PRIORITY,
    },
    {
      url: absoluteUrl(ROUTES.terms),
      lastModified,
      changeFrequency: "yearly",
      priority: LEGAL_PRIORITY,
    },
  ];
}
