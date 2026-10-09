import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/config";
import { ROUTES } from "@/lib/routes";
import { SITE_DESCRIPTION, SITE_TITLE } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_TITLE,
    short_name: BRAND,
    description: SITE_DESCRIPTION,
    start_url: ROUTES.home,
    display: "standalone",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
