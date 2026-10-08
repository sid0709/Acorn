import { AutoFocusSwitch } from "./AutoFocusSwitch";
import { UsageHistoryList } from "./UsageHistoryList";
import { useAiUsage } from "./use-ai-usage";

import type { AcornMainTab } from "./SidebarNav";
import type { ReactNode } from "react";

interface Props {
  mainTab: AcornMainTab;
  nowCard: ReactNode;
  tabId: number | null;
  signedIn: boolean;
  /** The service worker's socket: usage is pushed live only while it is connected. */
  socketConnected: boolean;
}

/** The Jobs tab: the tab's job, the run switches, and that tab's AI usage. */
export function JobsPanel({ mainTab, nowCard, tabId, signedIn, socketConnected }: Props) {
  const usage = useAiUsage(tabId, mainTab === "fill", signedIn, socketConnected);
  return (
    <section
      id="acorn-panel-fill"
      className="acorn-panel"
      aria-label="Jobs"
      hidden={mainTab !== "fill"}
    >
      {nowCard}
      <AutoFocusSwitch />
      <UsageHistoryList
        entries={usage.entries}
        totalPrice={usage.totalPrice}
        loading={usage.loading}
        error={usage.error}
        tabId={tabId}
        onRefresh={usage.reload}
      />
    </section>
  );
}
