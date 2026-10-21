import { acornGmailConnectUrl } from "@acorn/shared/gmail";
import { isRunMap } from "@acorn/shared/run-types";
import { NOTICE_ACTION, type NoticeAction } from "@acorn/shared/user-messages";
import { ACORN_WEB_PATH, OPENROUTER_CREDITS_URL, acornWebUrl } from "@acorn/shared/web-links";
import { useEffect, useRef } from "react";

import { DEFAULT_ACORN_WEB_URL } from "../auth/acorn-auth";

import { bindNoticeActions } from "./acorn-notice";
import { showOnPage } from "./show-on-page";

import type { TabPipelineMap } from "../tab-pipeline-session";

type NoticeActionDeps = {
  pipelines: TabPipelineMap;
  /** Run on the active tab; `true` carries on from where the last run stopped. */
  startRun: (continueRun?: boolean) => Promise<void> | void;
  openReport: () => void;
  openJobQueue: () => void;
};

function openPage(url: string): void {
  void chrome.tabs.create({ url });
}

/** Where the control that sends the page sits on a tab's map (CSS pixels), when the run named one. */
function keyOf(pipelines: TabPipelineMap, tabId: number | undefined): number | null {
  const map = tabId == null ? null : pipelines[String(tabId)]?.run?.map;
  if (!map || !isRunMap(map) || !map.key) return null;
  return (map.key.from + map.key.to) / 2;
}

/**
 * Runs the buttons of the notification cards (user-messages.ts NOTICE_ACTION): Continue and Run again on the
 * notice's tab (it is the focused one, as only its notices show), the job queue, the page's Submit, the
 * person's profile, Library and Gmail connection on the website, OpenRouter's credits page, and a report.
 */
export function useNoticeActions(deps: NoticeActionDeps): void {
  const latest = useRef(deps);
  latest.current = deps;

  useEffect(
    () =>
      bindNoticeActions((action: NoticeAction, tabId) => {
        const { pipelines, startRun, openReport, openJobQueue } = latest.current;
        switch (action) {
          case NOTICE_ACTION.continue:
            void startRun(true);
            return;
          case NOTICE_ACTION.runAgain:
            void startRun();
            return;
          case NOTICE_ACTION.jobQueue:
            openJobQueue();
            return;
          case NOTICE_ACTION.showOnPage: {
            const y = keyOf(pipelines, tabId);
            if (tabId != null && y != null) void showOnPage(tabId, { y });
            return;
          }
          case NOTICE_ACTION.openProfile:
            openPage(acornWebUrl(DEFAULT_ACORN_WEB_URL, ACORN_WEB_PATH.profile));
            return;
          case NOTICE_ACTION.openLibrary:
            openPage(acornWebUrl(DEFAULT_ACORN_WEB_URL, ACORN_WEB_PATH.resumeLibrary));
            return;
          case NOTICE_ACTION.reconnectGmail:
            openPage(acornGmailConnectUrl(DEFAULT_ACORN_WEB_URL));
            return;
          case NOTICE_ACTION.addCredits:
            openPage(OPENROUTER_CREDITS_URL);
            return;
          case NOTICE_ACTION.report:
            openReport();
            return;
        }
      }),
    [],
  );
}
