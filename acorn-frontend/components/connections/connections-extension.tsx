import { SectionCard } from "sid-ui";
import { DownloadCards } from "@/components/apps/download-cards";
import { extensionDownloadUrl, extensionInstallUrl, extensionVersion } from "@/lib/config";

/** The browser extension: install status and downloads for each browser. */
export function ConnectionsExtension() {
  const version = extensionVersion();
  return (
    <SectionCard
      title="Browser extension"
      description="Install once per browser. Your profile and settings follow your account."
    >
      <DownloadCards
        installUrl={extensionInstallUrl()}
        downloadUrl={extensionDownloadUrl()}
        extensionVersion={version}
      />
    </SectionCard>
  );
}
