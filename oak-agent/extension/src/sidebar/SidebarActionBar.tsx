import type { PipelineProgress } from "../../../shared/pipeline-types";
import { FillIcon, JdShotIcon, SentIcon } from "./sidebar-icons";

type SidebarActionBarProps = {
  fillPhase: PipelineProgress["phase"];
  fillLabel: string;
  jdShotLabel: string;
  sentLabel: string;
  fillDisabled: boolean;
  jdShotDisabled: boolean;
  sentDisabled: boolean;
  fillTitle?: string;
  jdShotTitle?: string;
  sentTitle?: string;
  onFill: () => void;
  onJdShot: () => void;
  onSent: () => void;
};

export function SidebarActionBar({
  fillPhase,
  fillLabel,
  jdShotLabel,
  sentLabel,
  fillDisabled,
  jdShotDisabled,
  sentDisabled,
  fillTitle,
  jdShotTitle,
  sentTitle,
  onFill,
  onJdShot,
  onSent,
}: SidebarActionBarProps) {
  return (
    <div className="oak-booking-bar">
      <button
        type="button"
        className="oak-action-btn"
        onClick={onJdShot}
        disabled={jdShotDisabled}
        title={jdShotTitle ?? jdShotLabel}
      >
        <JdShotIcon />
        <span>{jdShotLabel}</span>
      </button>
      <button
        type="button"
        className={`oak-action-btn primary fill-card ${fillPhase}`}
        onClick={onFill}
        disabled={fillDisabled}
        title={fillTitle ?? fillLabel}
      >
        <FillIcon />
        <span>{fillLabel}</span>
      </button>
      <button
        type="button"
        className="oak-action-btn"
        onClick={onSent}
        disabled={sentDisabled}
        title={sentTitle ?? sentLabel}
      >
        <SentIcon />
        <span>{sentLabel}</span>
      </button>
    </div>
  );
}
