import { NOTICE_ACTION_LABEL } from "@acorn/shared/user-messages";
import { useEffect, useRef, useState } from "react";
import { Glyph, useNotification } from "sid-ui";

import { flashFromNotice } from "../acorn-face/face-flash";
import { MSG, type AcornNoticePayload } from "../types";

import {
  KIND_TONE,
  bindAcornNoticeClear,
  bindAcornNoticePush,
  noticeDuration,
  pushAcornNotice,
  runNoticeAction,
} from "./acorn-notice";

/**
 * Shows Acorn notices as design-system notification cards: a tone and its icon, a title, what it means
 * and what to do, up to two buttons that do it (run on the notice's tab), and the time left as a bar. One
 * that waits on the person stays until it is acted on, dismissed, or the run on its tab moves on. A notice
 * tagged with a tab id only appears while that tab is the focused one in this window, and is dismissed as
 * soon as another tab is focused. Each tab shows one notice at a time, and a notice with the id of one on
 * screen replaces it. Renders nothing itself; AppTheme owns the viewport.
 */
export function AcornNoticeHost() {
  const notify = useNotification();
  const focusedTabId = useFocusedTabId();
  const focusedRef = useRef(focusedTabId);
  focusedRef.current = focusedTabId;
  const dismissByTab = useRef(new Map<number, () => void>());
  const dismissById = useRef(new Map<string, () => void>());

  useEffect(() => {
    const current = focusedTabId;
    if (current == null) return;
    for (const [tabId, dismiss] of dismissByTab.current) {
      if (tabId === current) continue;
      dismiss();
      dismissByTab.current.delete(tabId);
    }
  }, [focusedTabId]);

  useEffect(() => {
    const unbindPush = bindAcornNoticePush((notice) => {
      const tabId = notice.tabId;
      if (tabId != null && tabId !== focusedRef.current) return;
      if (tabId != null) dismissByTab.current.get(tabId)?.();
      if (notice.id) dismissById.current.get(notice.id)?.();
      const dismiss = notify({
        tone: notice.tone ?? KIND_TONE[notice.kind],
        icon: notice.glyph ? <Glyph name={notice.glyph} /> : undefined,
        title: notice.title,
        description: notice.detail || undefined,
        duration: noticeDuration(notice),
        actions: (notice.actions ?? []).slice(0, 2).map((action, index) => ({
          label: NOTICE_ACTION_LABEL[action],
          variant: index === 0 ? "primary" : "secondary",
          onClick: () => runNoticeAction(action, tabId),
        })),
      });
      flashFromNotice(notice.kind, notice.title);
      if (tabId != null) dismissByTab.current.set(tabId, dismiss);
      if (notice.id) dismissById.current.set(notice.id, dismiss);
    });
    const unbindClear = bindAcornNoticeClear((tabId) => {
      dismissByTab.current.get(tabId)?.();
      dismissByTab.current.delete(tabId);
    });
    return () => {
      unbindPush();
      unbindClear();
    };
  }, [notify]);

  useEffect(() => {
    const onMessage = (message: { type?: string; notice?: AcornNoticePayload }) => {
      if (message.type !== MSG.OPERATOR_NOTICE || !message.notice?.title) return;
      const { kind } = message.notice;
      if (kind !== "error" && kind !== "success" && kind !== "info") return;
      pushAcornNotice(message.notice);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  return null;
}

/** The tab focused in the window this side panel belongs to. */
function useFocusedTabId(): number | null {
  const [tabId, setTabId] = useState<number | null>(null);

  useEffect(() => {
    let windowId: number | undefined;
    const inThisWindow = (fromWindow: number | undefined) =>
      windowId == null || fromWindow == null || fromWindow === windowId;

    const readFocused = () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        setTabId(tabs[0]?.id ?? null);
      });
    };

    chrome.windows.getCurrent((win) => {
      windowId = win.id;
      readFocused();
    });

    const onActivated = (info: chrome.tabs.TabActiveInfo) => {
      if (!inThisWindow(info.windowId)) return;
      setTabId(info.tabId);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    return () => chrome.tabs.onActivated.removeListener(onActivated);
  }, []);

  return tabId;
}
