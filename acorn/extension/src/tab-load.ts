/**
 * Waits on a tab's page load. The queue waits for a job's page before a Run starts on it, and a Run
 * waits for the page an emailed link leads to before it looks again.
 */

interface LoadWatch {
  tabId: number;
  /** The most the wait lasts: a page that never says it finished is looked at anyway. */
  timeoutMs: number;
  /**
   * True when the page the tab shows now is not the one waited for: a navigation is about to be
   * asked for, and the old page's "complete" must not count. Only a "complete" after the tab
   * reported loading (or a new address) ends the wait.
   */
  afterNavigation: boolean;
}

/** Resolves true once the page has loaded (or the wait ran out), false if the tab was closed first. */
function watchLoad({ tabId, timeoutMs, afterNavigation }: LoadWatch): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let navigating = !afterNavigation;
    const finish = (result: boolean) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve(result);
    };
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id !== tabId) return;
      if (info.status === "loading" || info.url) navigating = true;
      if (navigating && info.status === "complete") finish(true);
    };
    const onRemoved = (id: number) => {
      if (id === tabId) finish(false);
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    if (afterNavigation) return;
    void chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === "complete") finish(true);
      },
      () => finish(false),
    );
  });
}

/** Resolves true once the tab has loaded its page (or the wait ran out), false if the tab was closed first. */
export function whenTabLoaded(tabId: number, timeoutMs: number): Promise<boolean> {
  return watchLoad({ tabId, timeoutMs, afterNavigation: false });
}

/**
 * Follows a navigation about to be asked for in the tab: resolves true once the page it leads to has
 * loaded (or the wait ran out), false if the tab was closed first. Call it before the navigation, so
 * the page the tab shows now is not taken for the one it is going to.
 */
export function whenTabNavigated(tabId: number, timeoutMs: number): Promise<boolean> {
  return watchLoad({ tabId, timeoutMs, afterNavigation: true });
}
