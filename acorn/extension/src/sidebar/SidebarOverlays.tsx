import { FaceGuidePanel } from "./FaceGuidePanel";
import { SettingsDrawer } from "./SettingsDrawer";

import type { BusyCounts, SidebarAuth } from "./sidebar-panel-types";
import type { GmailStatus } from "./use-gmail-status";

interface Props {
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  busyCounts: BusyCounts;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  connected: boolean;
  session: SidebarAuth["session"];
  apiUrl: SidebarAuth["apiUrl"];
  setApiUrl: SidebarAuth["setApiUrl"];
  gmail: GmailStatus;
}

/** Drawers and panels over the sidebar: the Face guide, and settings. */
export function SidebarOverlays({
  helpOpen,
  setHelpOpen,
  busyCounts,
  settingsOpen,
  setSettingsOpen,
  connected,
  session,
  apiUrl,
  setApiUrl,
  gmail,
}: Props) {
  return (
    <>
      {/* Mounted only while open: the guide runs a live Acorn Face per mood. */}
      {helpOpen ? (
        <FaceGuidePanel
          isOpen
          onOpenChange={setHelpOpen}
          thinking={busyCounts.thinking}
          working={busyCounts.working}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsDrawer
          isOpen
          onOpenChange={setSettingsOpen}
          connected={connected}
          signedIn={Boolean(session)}
          apiUrl={apiUrl}
          onApiUrlChange={setApiUrl}
          gmailConnected={gmail.connected}
          gmailEmail={gmail.email}
          gmailLoading={gmail.loading}
        />
      ) : null}
    </>
  );
}
