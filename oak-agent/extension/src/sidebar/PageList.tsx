import { useLayoutEffect, useRef, useState } from "react";
import { formatNanosUsd } from "../../../shared/ai-usage";
import { isFillPhaseBusy, type PipelineProgress } from "../../../shared/pipeline-types";
import { FACE_WINK_MS } from "../oak-face/constants";
import { resolveRowHold } from "../oak-face/director";
import { flashOakFace } from "../oak-face/face-flash";
import { useCompletionSmile } from "../oak-face/use-completion-smile";
import { fetchLibraryResume } from "../pipeline/ai-client";
import { pageHasResume, type OakPageBinding } from "../tab-page-session";
import type { TabPipelineMap } from "../tab-pipeline-session";
import { triggerResumeDownload } from "./download-resume";
import { pushOakNotice } from "./oak-notice";
import { SidebarListCard } from "./SidebarListCard";

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url || "Unknown page";
  }
}

/** The résumé line of a page: what the last JD shot picked, or what it found instead. */
export function pageResumeLine(
  page: OakPageBinding,
  filling: boolean,
): { text: string; ready: boolean; failed: boolean } {
  if (page.jdStatus === "running")
    return { text: "Reading the page…", ready: false, failed: false };
  if (filling) return { text: "Filling…", ready: false, failed: false };
  if (pageHasResume(page)) {
    return { text: `Résumé: ${page.resumeStack || "picked"}`, ready: true, failed: false };
  }
  if (page.jdStatus === "failed") {
    return { text: page.jdMessage || "JD shot failed", ready: false, failed: true };
  }
  if (page.jdStatus === "none" || (page.jdStatus === "found" && page.jdMessage)) {
    return {
      text: page.jdMessage || "No job description on this page",
      ready: false,
      failed: false,
    };
  }
  return { text: "No JD shot yet — Fill uses your primary résumé", ready: false, failed: false };
}

/** Cost of a page as the card shows it; empty until the backend has answered. */
export function pageCostLine(page: OakPageBinding): string {
  if (page.costNanos == null) return "Cost —";
  const calls = page.costCalls === 1 ? "1 call" : `${page.costCalls} calls`;
  return `Cost ${formatNanosUsd(page.costNanos)} · ${calls}`;
}

type PageListProps = {
  pages: OakPageBinding[];
  pipelines: TabPipelineMap;
  activeTabId: number | null;
  sendingTabIds: ReadonlySet<number>;
  listActive?: boolean;
  onFocus: (tabId: number) => void;
  onForget: (tabId: number) => void;
};

export function PageList({
  pages,
  pipelines,
  activeTabId,
  sendingTabIds,
  listActive = true,
  onFocus,
  onForget,
}: PageListProps) {
  const listRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (!listActive || activeTabId == null) return;
    const node = listRef.current?.querySelector(
      `[data-item-id="${CSS.escape(String(activeTabId))}"]`,
    );
    if (!(node instanceof HTMLElement)) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [listActive, activeTabId, pages.length]);

  return (
    <section className="worker-pool">
      <div className="worker-pool-head">
        <div>
          <h3>Pages</h3>
          <p className="worker-pool-count">
            {pages.length === 1 ? "1 page" : `${pages.length} pages`}
          </p>
        </div>
      </div>
      {pages.length === 0 ? (
        <p className="hint">
          Open a job page and press Fill page, JD shot or Add this page. It stays here until you
          press Sent.
        </p>
      ) : (
        <nav ref={listRef} className="worker-pool-list" aria-label="Pages">
          {pages.map((page) => (
            <PageRow
              key={page.tabId}
              page={page}
              progress={pipelines[String(page.tabId)]}
              selected={page.tabId === activeTabId}
              sending={sendingTabIds.has(page.tabId)}
              onFocus={() => onFocus(page.tabId)}
              onForget={() => onForget(page.tabId)}
            />
          ))}
        </nav>
      )}
    </section>
  );
}

function PageRow({
  page,
  progress,
  selected,
  sending,
  onFocus,
  onForget,
}: {
  page: OakPageBinding;
  progress?: PipelineProgress;
  selected: boolean;
  sending: boolean;
  onFocus: () => void;
  onForget: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const filling = isFillPhaseBusy(progress?.phase ?? "idle");
  const { text: resumeText, ready, failed } = pageResumeLine(page, filling);
  const host = hostOf(page.url);
  const label = page.title || "Untitled";

  const hold = resolveRowHold({
    fillPhase: progress?.phase ?? "idle",
    resumeSkipped: progress?.resumeUpload?.status === "skipped",
    jdStatus: page.jdStatus,
    sending,
    downloading: busy,
  });
  const faceMode = useCompletionSmile({
    hold,
    fillPhase: progress?.phase ?? "idle",
    jdStatus: page.jdStatus,
  });

  const download = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const file = await fetchLibraryResume(String(page.resumeId || ""));
      if (!file?.base64 || !file.name) {
        pushOakNotice({
          kind: "error",
          title: "Couldn’t download résumé",
          detail: "Could not download the Library résumé",
        });
        return;
      }
      triggerResumeDownload(file);
      flashOakFace({ mode: "wink", ms: FACE_WINK_MS });
    } catch (err) {
      pushOakNotice({
        kind: "error",
        title: "Couldn’t download résumé",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidebarListCard
      itemId={String(page.tabId)}
      selected={selected}
      faceMode={faceMode}
      logoUrl={page.favIconUrl ?? undefined}
      logoFallback={label || host}
      title={label}
      subtitle={host}
      resumeText={resumeText}
      resumeReady={ready}
      resumeFailed={failed}
      costText={pageCostLine(page)}
      open={{
        title: "Show this tab",
        label: `Show tab for ${label}`,
        current: selected,
        onClick: onFocus,
      }}
      download={{
        title: busy ? "Downloading…" : ready ? "Download résumé" : "No résumé picked yet",
        label: busy
          ? "Downloading résumé"
          : ready
            ? `Download résumé for ${label}`
            : `No résumé picked yet for ${label}`,
        disabled: !ready || busy,
        onClick: () => void download(),
      }}
      forget={{
        title: "Forget this page (keeps the tab open)",
        label: `Forget ${label}`,
        disabled: sending,
        onClick: onForget,
      }}
    />
  );
}
