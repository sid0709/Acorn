import { AutoFocusSwitch } from "./AutoFocusSwitch";
import { RunMapCard } from "./RunMapCard";

import type { AcornMainTab } from "./SidebarNav";
import type { PipelineProgress } from "@acorn/shared/pipeline-types";
import type { ReactNode } from "react";

interface Props {
  mainTab: AcornMainTab;
  nowCard: ReactNode;
  /** The run on the active tab, as the Now card and the map show it. */
  progress: PipelineProgress;
}

/** The Jobs tab: the Auto-Focus switch, the active tab's run and its actions, and the map of the page the run is on. */
export function JobsPanel({ mainTab, nowCard, progress }: Props) {
  return (
    <section
      id="acorn-panel-fill"
      className="acorn-panel"
      aria-label="Jobs"
      hidden={mainTab !== "fill"}
    >
      <AutoFocusSwitch />
      {nowCard}
      <RunMapCard progress={progress} />
    </section>
  );
}
