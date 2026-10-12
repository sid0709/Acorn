/** The main document's frame id. */
const MAIN_FRAME_ID = 0;
/** How long a fill waits for a page the site sent away to load again. */
export const FRAME_RELOAD_MAX_MS = 60_000;

export interface FrameDocumentWatch {
  /** The fill's document is being replaced: it, or a frame that holds it, started to navigate. */
  left: () => boolean;
  /** Resolves once the new document has loaded (or the wait ran out). */
  arrived: () => Promise<void>;
  stop: () => void;
}

/** The frame and every frame that holds it, up to the main document. */
async function frameChain(tabId: number, frameId: number): Promise<Set<number>> {
  const chain = new Set([frameId, MAIN_FRAME_ID]);
  try {
    const frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
    const parentOf = new Map(frames.map((frame) => [frame.frameId, frame.parentFrameId]));
    for (let id = parentOf.get(frameId); id != null && id >= 0; id = parentOf.get(id)) {
      if (chain.has(id) && id !== MAIN_FRAME_ID) break;
      chain.add(id);
    }
  } catch {
    // A restricted page lists no frames: the frame and the main document are watched.
  }
  return chain;
}

/**
 * Watch whether the document a fill works in is replaced while it works: a page
 * that answers an upload by sending its form (and drawing itself again with the
 * fields reset) leaves a fill that went on writing into a page about to vanish.
 * Only a real navigation counts; a page that rewrites its address in place
 * (history or a fragment) keeps its document.
 */
export async function watchFrameDocument(
  tabId: number,
  frameId: number | null,
): Promise<FrameDocumentWatch> {
  const chain = await frameChain(tabId, frameId ?? MAIN_FRAME_ID);
  let leaving: number | null = null;
  let landed: () => void = () => undefined;
  const landing = new Promise<void>((resolve) => {
    landed = resolve;
  });

  const onBefore = (details: chrome.webNavigation.WebNavigationParentedCallbackDetails) => {
    if (details.tabId !== tabId || !chain.has(details.frameId)) return;
    leaving ??= details.frameId;
  };
  const onDone = (details: { tabId: number; frameId: number }) => {
    if (details.tabId === tabId && details.frameId === leaving) landed();
  };
  const onRemoved = (removedTabId: number) => {
    if (removedTabId === tabId) landed();
  };
  chrome.webNavigation.onBeforeNavigate.addListener(onBefore);
  chrome.webNavigation.onCompleted.addListener(onDone);
  chrome.webNavigation.onErrorOccurred.addListener(onDone);
  chrome.tabs.onRemoved.addListener(onRemoved);

  const stop = () => {
    chrome.webNavigation.onBeforeNavigate.removeListener(onBefore);
    chrome.webNavigation.onCompleted.removeListener(onDone);
    chrome.webNavigation.onErrorOccurred.removeListener(onDone);
    chrome.tabs.onRemoved.removeListener(onRemoved);
    landed();
  };

  return {
    left: () => leaving != null,
    arrived: () =>
      Promise.race([
        landing,
        new Promise<void>((resolve) => setTimeout(resolve, FRAME_RELOAD_MAX_MS)),
      ]),
    stop,
  };
}
