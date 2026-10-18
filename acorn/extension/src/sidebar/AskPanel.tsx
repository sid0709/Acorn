import { QaPanel } from "./QaPanel";

import type { AcornMainTab } from "./SidebarNav";

interface Props {
  mainTab: AcornMainTab;
  fillBusy: boolean;
  setQaStatus: (status: { busy: boolean; error: boolean }) => void;
  tabId: number | null;
}

/** The Ask tab: answers to a form question the Run left blank. */
export function AskPanel({ mainTab, fillBusy, setQaStatus, tabId }: Props) {
  return (
    <section
      id="acorn-panel-qa"
      className="acorn-panel acorn-panel-ask"
      aria-label="Ask"
      hidden={mainTab !== "qa"}
    >
      <QaPanel signedIn disabled={fillBusy} onStatus={setQaStatus} tabId={tabId} />
    </section>
  );
}
