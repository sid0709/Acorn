import { type ReactNode } from "react";
import type { OakFaceMode } from "@oak/face";
import { ListCardMark } from "../oak-face/ListCardMark";
import { CloseIcon, DownloadIcon } from "./sidebar-icons";

export type SidebarListCardAction = {
  title: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

type SidebarListCardProps = {
  itemId: string;
  selected: boolean;
  faceMode: OakFaceMode;
  logoUrl?: string;
  logoFallback: string;
  title: string;
  subtitle: string;
  /** The résumé line: the picked Library résumé, or why there is none yet. */
  resumeText: string;
  resumeReady: boolean;
  resumeFailed?: boolean;
  /** What the models cost this page so far. */
  costText: string;
  open: SidebarListCardAction & { current?: boolean };
  download: SidebarListCardAction;
  forget: SidebarListCardAction;
  children?: ReactNode;
};

function CardIconButton({
  className,
  action,
  children,
}: {
  className: string;
  action: SidebarListCardAction;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      disabled={action.disabled}
      title={action.title}
      aria-label={action.label}
      onClick={action.onClick}
    >
      {children}
    </button>
  );
}

export function SidebarListCard({
  itemId,
  selected,
  faceMode,
  logoUrl,
  logoFallback,
  title,
  subtitle,
  resumeText,
  resumeReady,
  resumeFailed = false,
  costText,
  open,
  download,
  forget,
  children,
}: SidebarListCardProps) {
  return (
    <div
      data-item-id={itemId}
      className={`worker-pool-item fill-job${selected ? " selected" : ""}`}
    >
      <button
        type="button"
        className="worker-pool-card-hit"
        disabled={open.disabled}
        aria-current={open.current ? "page" : undefined}
        aria-label={open.label}
        title={open.title}
        onClick={open.onClick}
      />
      <div className="worker-pool-open">
        <ListCardMark
          itemId={itemId}
          logoUrl={logoUrl}
          fallback={logoFallback}
          faceMode={faceMode}
          selected={selected}
          label={`${title} status`}
        />
        <span className="job-list-copy">
          <strong className="worker-pool-title" title={title}>
            {title}
          </strong>
          <span className="worker-pool-company" title={subtitle}>
            {subtitle}
          </span>
          <span
            className={`worker-pool-resume${
              resumeReady ? "" : resumeFailed ? " is-failed" : " muted"
            }`}
            title={resumeText}
          >
            {resumeText}
          </span>
          <span
            className="worker-pool-resume muted worker-pool-cost"
            title="Model cost for this page"
          >
            {costText}
          </span>
        </span>
      </div>
      <div className="worker-pool-actions">
        <CardIconButton className="worker-pool-icon-btn" action={download}>
          <DownloadIcon />
        </CardIconButton>
        <CardIconButton className="worker-pool-applied" action={forget}>
          <CloseIcon />
        </CardIconButton>
      </div>
      {children}
    </div>
  );
}
