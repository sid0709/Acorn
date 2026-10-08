import type { Metadata } from "next";
import { PageHeader, SectionCard, Stack } from "sid-ui";
import { DownloadCards } from "@/components/apps/download-cards";
import { extensionDownloadUrl, extensionInstallUrl, extensionVersion } from "@/lib/config";

export const metadata: Metadata = { title: "Apps" };

export default function AppsPage() {
  const installUrl = extensionInstallUrl();
  const downloadUrl = extensionDownloadUrl();
  const version = extensionVersion();
  const description =
    version && downloadUrl
      ? `Download v${version} for Chrome, or install from the store when the listing is live. Your profile and settings follow your account.`
      : installUrl
        ? "Install once per browser. Your profile and settings follow your account."
        : "After deploy, the packed Chrome extension appears here with its version. Optional: set ACORN_EXTENSION_INSTALL_URL for the store button.";
  return (
    <Stack gap={6}>
      <PageHeader title="Apps" description="Get Acorn for your browser." />
      <SectionCard title="Get Acorn" description={description}>
        <DownloadCards
          installUrl={installUrl}
          downloadUrl={downloadUrl}
          extensionVersion={version}
        />
      </SectionCard>
    </Stack>
  );
}
