import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing-page";
import { currentAccount } from "@/lib/auth/session";
import { extensionDownloadUrl, extensionInstallUrl } from "@/lib/config";
import { INSTALL_HREF, ROUTES } from "@/lib/routes";
import { SITE_TITLE, homeStructuredData, serializeJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  alternates: { canonical: ROUTES.home },
};

export default async function HomePage() {
  if (await currentAccount()) redirect(ROUTES.overview);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(homeStructuredData()) }}
      />
      <LandingPage
        installHref={extensionInstallUrl() ?? INSTALL_HREF}
        downloadUrl={extensionDownloadUrl()}
      />
    </>
  );
}
