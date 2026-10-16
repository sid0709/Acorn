import { useEffect, useState } from "react";

import { fetchGmailConnectionStatus } from "../agent/gmail-connection";

import { FaceGuidePanel } from "./FaceGuidePanel";
import { ResumePreviewPanel } from "./ResumePreviewPanel";
import { SettingsDrawer } from "./SettingsDrawer";

import type { BusyCounts, ResumePreview, SidebarAuth } from "./sidebar-panel-types";

interface Props {
  preview: ResumePreview["preview"];
  setPreview: ResumePreview["setPreview"];
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  busyCounts: BusyCounts;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  connected: boolean;
  session: SidebarAuth["session"];
  apiUrl: SidebarAuth["apiUrl"];
  setApiUrl: SidebarAuth["setApiUrl"];
}

/** Drawers and panels over the sidebar: the résumé preview, the Face guide, and settings. */
export function SidebarOverlays({
  preview,
  setPreview,
  helpOpen,
  setHelpOpen,
  busyCounts,
  settingsOpen,
  setSettingsOpen,
  connected,
  session,
  apiUrl,
  setApiUrl,
}: Props) {
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | undefined>();

  useEffect(() => {
    if (!settingsOpen || !session?.accessToken) {
      setGmailLoading(false);
      setGmailConnected(false);
      setGmailEmail(undefined);
      return;
    }
    setGmailLoading(true);
    void fetchGmailConnectionStatus(session.accessToken, apiUrl)
      .then((status) => {
        setGmailConnected(status.connected);
        setGmailEmail(status.email);
      })
      .finally(() => setGmailLoading(false));
  }, [settingsOpen, session?.accessToken, apiUrl]);

  return (
    <>
      {preview ? (
        <ResumePreviewPanel
          title={preview.title}
          sourceKey={preview.sourceKey}
          loadHtml={preview.loadHtml}
          downloadFile={preview.downloadFile}
          onClose={() => setPreview(null)}
        />
      ) : null}

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
          gmailConnected={gmailConnected}
          gmailEmail={gmailEmail}
          gmailLoading={gmailLoading}
        />
      ) : null}
    </>
  );
}
