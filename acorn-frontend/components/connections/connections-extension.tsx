import { SectionCard } from "sid-ui";
import { DownloadCards } from "@/components/apps/download-cards";
import { OakExtensionCard } from "@/components/connections/oak-extension-card";
import {
  extensionDownloadUrl,
  extensionInstallUrl,
  extensionVersion,
  oakExtensionDownloadUrl,
  oakExtensionVersion,
} from "@/lib/config";

/** The browser extensions: install status and downloads for each browser, and Oak. */
export function ConnectionsExtension() {
  const version = extensionVersion();
  return (
    <>
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
      <SectionCard
        title="Oak extension"
        description="The page-by-page filler. It signs in with the same account."
      >
        <OakExtensionCard downloadUrl={oakExtensionDownloadUrl()} version={oakExtensionVersion()} />
      </SectionCard>
    </>
  );
}
