import { QaPanel } from "./QaPanel";

import type { TabSession } from "./sidebar-panel-types";
import type { AcornMainTab } from "./SidebarNav";

interface Props {
  mainTab: AcornMainTab;
  fillBusy: boolean;
  setQaStatus: (status: { busy: boolean; error: boolean }) => void;
  tabJob: TabSession["tabJob"];
  tabId: number | null;
}

/** The Ask tab: Q&A about the job on this tab. */
export function AskPanel({ mainTab, fillBusy, setQaStatus, tabJob, tabId }: Props) {
  return (
    <section
      id="acorn-panel-qa"
      className="acorn-panel acorn-panel-ask"
      aria-label="Ask"
      hidden={mainTab !== "qa"}
    >
      <QaPanel
        signedIn
        disabled={fillBusy}
        onStatus={setQaStatus}
        tabId={tabId}
        page={
          tabJob
            ? {
                job: {
                  id: tabJob.jobId,
                  title: tabJob.title,
                  company: tabJob.company,
                },
              }
            : null
        }
      />
    </section>
  );
}
