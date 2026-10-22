import { getPage } from "../tab-page-session";
import { requestSent, type SentResult } from "./ai-client";

const DEBUGGER_VERSION = "1.3";
const SCREENSHOT_FORMAT = "jpeg";
const SCREENSHOT_QUALITY = 70;
/** Chrome cannot render a taller capture than this. */
const MAX_CAPTURE_HEIGHT_PX = 16_384;

type LayoutMetrics = {
  cssLayoutViewport?: { clientWidth: number };
  layoutViewport?: { clientWidth: number };
  cssContentSize?: { height: number };
  contentSize?: { height: number };
};

function debuggerFailure(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/already attached/i.test(message)) {
    return new Error(
      "Another debugger (DevTools or another extension) is attached to this tab. Close it and press Sent again.",
    );
  }
  if (/cannot (attach|access)|not allowed|chrome:\/\//i.test(message)) {
    return new Error("Chrome does not allow a screenshot of this page.");
  }
  return new Error(`Could not take the screenshot: ${message}`);
}

/** Full-page JPEG of a tab (base64, no `data:` prefix), through the Chrome debugger. */
export async function captureFullPage(tabId: number): Promise<string> {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, DEBUGGER_VERSION);
  } catch (err) {
    throw debuggerFailure(err);
  }
  try {
    const metrics = (await chrome.debugger.sendCommand(
      target,
      "Page.getLayoutMetrics",
    )) as LayoutMetrics;
    const width = metrics.cssLayoutViewport?.clientWidth ?? metrics.layoutViewport?.clientWidth;
    const contentHeight = metrics.cssContentSize?.height ?? metrics.contentSize?.height;
    if (!width || !contentHeight) {
      throw new Error("the page reported no size");
    }
    const shot = (await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
      format: SCREENSHOT_FORMAT,
      quality: SCREENSHOT_QUALITY,
      captureBeyondViewport: true,
      fromSurface: true,
      clip: {
        x: 0,
        y: 0,
        width,
        height: Math.min(Math.ceil(contentHeight), MAX_CAPTURE_HEIGHT_PX),
        scale: 1,
      },
    })) as { data?: string };
    if (!shot.data) throw new Error("Chrome returned no image");
    return shot.data;
  } catch (err) {
    throw debuggerFailure(err);
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}

/** Takes the screenshot and counts the page as sent. Nothing is closed or forgotten here. */
export async function sendPage(args: { tabId: number; apiUrl: string }): Promise<SentResult> {
  const { tabId, apiUrl } = args;
  const page = await getPage(tabId);
  const tab = await chrome.tabs.get(tabId);
  const screenshot = await captureFullPage(tabId);
  const endedAt = Date.now();
  return requestSent(
    {
      url: tab.url || page?.url || "",
      title: tab.title || page?.title || "",
      durationMs: page?.workMs ?? 0,
      steps: page?.steps ?? 0,
      endedAt,
      utcOffsetMinutes: -new Date(endedAt).getTimezoneOffset(),
      screenshot,
    },
    apiUrl,
    tabId,
  );
}
