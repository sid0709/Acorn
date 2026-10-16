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
        />
      ) : null}
    </>
  );
}
