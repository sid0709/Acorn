import { traceFromBackground } from "./background/debug-trace-sink";

function contentScriptFiles(): string[] {
  const files: string[] = [];
  for (const spec of chrome.runtime.getManifest().content_scripts ?? []) {
    for (const file of spec.js ?? []) {
      if (!files.includes(file)) files.push(file);
    }
  }
  return files;
}

export function canInjectIntoUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === "chrome:" ||
      parsed.protocol === "chrome-extension:" ||
      parsed.protocol === "edge:" ||
      parsed.protocol === "devtools:" ||
      parsed.protocol === "view-source:"
    ) {
      return false;
    }
    if (parsed.hostname === "chrome.google.com" && parsed.pathname.startsWith("/webstore")) {
      return false;
    }
    if (parsed.hostname === "chromewebstore.google.com") return false;
    return true;
  } catch {
    return false;
  }
}

/** What one injection did: how many frames it reached, or why it could not. */
export type InjectionResult = { frames: number; error: string | null };

/**
 * Put the content script in the tab's frames (a frame that already has a working one
 * keeps it). A failure is returned and written to the tab's log, never swallowed: a
 * page the script cannot reach is otherwise a run that waits on a listener that is not there.
 */
export async function injectContentScripts(
  tabId: number,
  frameId?: number,
): Promise<InjectionResult> {
  const files = contentScriptFiles();
  if (files.length === 0) return { frames: 0, error: "the manifest lists no content script" };
  try {
    const reached = await chrome.scripting.executeScript({
      target:
        typeof frameId === "number" ? { tabId, frameIds: [frameId] } : { tabId, allFrames: true },
      files,
    });
    return { frames: reached.length, error: null };
  } catch (err) {
    // A closed tab or a restricted address is expected; anything else is evidence.
    const error = err instanceof Error ? err.message : String(err);
    traceFromBackground("inject:error", () => ({ tabId, frameId: frameId ?? "all", error }), tabId);
    return { frames: 0, error };
  }
}

export async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => {
      if (tab.id == null || !canInjectIntoUrl(tab.url)) return Promise.resolve();
      return injectContentScripts(tab.id);
    }),
  );
}

export function bindContentScriptInjection(): void {
  const onNavigate = (details: { tabId: number; frameId: number; url: string }) => {
    if (!canInjectIntoUrl(details.url)) return;
    void injectContentScripts(details.tabId, details.frameId);
  };
  chrome.webNavigation.onCommitted.addListener(onNavigate);
  chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigate);
  chrome.runtime.onInstalled.addListener(() => {
    void injectIntoOpenTabs();
  });
}
