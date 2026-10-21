import { AutoFocusSwitch } from "./AutoFocusSwitch";

import type { AcornMainTab } from "./SidebarNav";
import type { ReactNode } from "react";

interface Props {
  mainTab: AcornMainTab;
  /** The active tab's card: its run, the map of its page with the page's questions, and the Run actions. */
  nowCard: ReactNode;
}

/** The Jobs tab: the Auto-Focus switch, and the active tab's run with the map of the page it is on. */
export function JobsPanel({ mainTab, nowCard }: Props) {
  return (
    <section
      id="acorn-panel-fill"
      className="acorn-panel"
      aria-label="Jobs"
      hidden={mainTab !== "fill"}
    >
      <AutoFocusSwitch />
      {nowCard}
    </section>
  );
}
