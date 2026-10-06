import type { ReactNode } from "react";
import type { AcornMainTab } from "./SidebarNav";
import { UsageHistoryList } from "./UsageHistoryList";
import { useAiUsage } from "./use-ai-usage";

interface Props {
  mainTab: AcornMainTab;
  nowCard: ReactNode;
  tabId: number | null;
  signedIn: boolean;
}

/** The Jobs tab: the tab's job, and that tab's AI usage. */
export function JobsPanel({ mainTab, nowCard, tabId, signedIn }: Props) {
  const usage = useAiUsage(tabId, mainTab === "fill", signedIn);
  return (
    <section
      id="acorn-panel-fill"
      className="acorn-panel"
      aria-label="Jobs"
      hidden={mainTab !== "fill"}
    >
      {nowCard}
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
