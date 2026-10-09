import { useEffect, useRef, useState } from "react";
import { Text, VStack, useToast } from "sid-ui";

import { flashFromNotice } from "../acorn-face/face-flash";
import { MSG, type AcornNoticePayload } from "../types";

import { bindAcornNoticePush, noticeKindDuration, pushAcornNotice } from "./acorn-notice";

/**
 * Shows Acorn notices as design-system toasts: ones pushed in the sidebar and ones the
 * service worker broadcasts. A notice tagged with a tab id only appears while that tab
 * is the focused one in this window, and is dismissed as soon as another tab is focused.
 * Each tab shows one notice at a time: a newer one replaces it instead of stacking.
 * Renders nothing itself; AppTheme owns the viewport.
 */
export function AcornNoticeHost() {
  const toast = useToast();
  const focusedTabId = useFocusedTabId();
  const focusedRef = useRef(focusedTabId);
  focusedRef.current = focusedTabId;
  const dismissByTab = useRef(new Map<number, () => void>());

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
    return bindAcornNoticePush((notice) => {
      const tabId = notice.tabId;
      if (tabId != null && tabId !== focusedRef.current) return;
      if (tabId != null) dismissByTab.current.get(tabId)?.();
      const dismiss = toast({
        type: notice.kind === "error" ? "error" : "info",
        // sid-ui keeps error toasts up until closed unless told otherwise.
        isAutoHide: true,
        autoHideDuration: noticeKindDuration(notice.kind),
        uniqueID: notice.id,
        body: (
          <VStack gap={0.5}>
            <Text weight="semibold" color="inherit">
              {notice.title}
            </Text>
            {notice.detail ? (
              <Text type="supporting" color="inherit">
                {notice.detail}
              </Text>
            ) : null}
          </VStack>
        ),
      });
      flashFromNotice(notice.kind, notice.title);
      if (tabId != null) dismissByTab.current.set(tabId, dismiss);
    });
  }, [toast]);

  useEffect(() => {
    const onMessage = (message: { type?: string; notice?: AcornNoticePayload }) => {
      if (message.type !== MSG.OPERATOR_NOTICE || !message.notice?.title) return;
      const { id, kind, title, detail, tabId } = message.notice;
      if (kind !== "error" && kind !== "success" && kind !== "info") return;
      pushAcornNotice({ id, kind, title, detail, tabId });
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
