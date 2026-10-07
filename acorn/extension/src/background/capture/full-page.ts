/**
 * A full-page screenshot of a tab: scroll it one viewport at a time, capture each
 * view, and draw them onto one canvas. Fixed and sticky elements show in the first
 * view only, so a pinned header is not repeated down the page. The page scroll and
 * those elements are put back afterwards.
 */

/** captureVisibleTab allows two calls a second per window. */
const CAPTURE_INTERVAL_MS = 600;
/** Lets lazy content and scroll handlers settle after each scroll. */
const SCROLL_SETTLE_MS = 150;
/** Pages longer than this many CSS pixels are captured to here. */
const MAX_PAGE_HEIGHT = 16_000;
/** The stitched image is scaled to at most this wide. */
const MAX_OUTPUT_WIDTH = 1600;
/** JPEG qualities to try, best first, until the image fits the API's limit. */
const JPEG_QUALITIES = [0.85, 0.7, 0.55] as const;
const HIDDEN_ATTR = "data-acorn-capture-hidden";

export type FullPageShot = { blob: Blob; mime: string; width: number; height: number };

type PageMetrics = {
  scrollHeight: number;
  innerHeight: number;
  innerWidth: number;
  scrollX: number;
  scrollY: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function inPage<A extends unknown[], R>(tabId: number, func: (...args: A) => R, args: A) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result?.result as Awaited<R>;
}

function readMetrics(): PageMetrics {
  const doc = document.documentElement;
  return {
    scrollHeight: Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0),
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

function scrollPage(y: number) {
  window.scrollTo({ top: y, left: 0, behavior: "instant" as ScrollBehavior });
}

function hidePinned(attr: string) {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const position = getComputedStyle(el).position;
    if (position !== "fixed" && position !== "sticky") continue;
    el.setAttribute(attr, el.style.visibility);
    el.style.visibility = "hidden";
  }
}

function restorePage(attr: string, x: number, y: number) {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`))) {
    el.style.visibility = el.getAttribute(attr) ?? "";
    el.removeAttribute(attr);
  }
  window.scrollTo({ top: y, left: x, behavior: "instant" as ScrollBehavior });
}

async function captureView(windowId: number): Promise<ImageBitmap> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

async function encode(canvas: OffscreenCanvas, maxBytes: number): Promise<Blob> {
  let last: Blob | null = null;
  for (const quality of JPEG_QUALITIES) {
    last = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (last.size <= maxBytes) return last;
  }
  return last as Blob;
}

/** The whole page of tabId (the active tab of windowId) as one JPEG under maxBytes. */
export async function captureFullPage(
  tabId: number,
  windowId: number,
  maxBytes: number,
): Promise<FullPageShot> {
  const metrics = await inPage(tabId, readMetrics, []);
  const viewHeight = Math.max(1, metrics.innerHeight);
  const pageHeight = Math.min(Math.max(metrics.scrollHeight, viewHeight), MAX_PAGE_HEIGHT);
  const stops: number[] = [];
  for (let y = 0; y < pageHeight; y += viewHeight) stops.push(Math.min(y, pageHeight - viewHeight));

  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let scale = 1;
  try {
    for (const [index, y] of stops.entries()) {
      await inPage(tabId, scrollPage, [y]);
      if (index === 1) await inPage(tabId, hidePinned, [HIDDEN_ATTR]);
      await sleep(index === 0 ? SCROLL_SETTLE_MS : CAPTURE_INTERVAL_MS);
      const view = await captureView(windowId);
      if (!canvas) {
        // Device pixels per CSS pixel, from the first capture.
        const ratio = view.width / Math.max(1, metrics.innerWidth);
        scale = Math.min(1, MAX_OUTPUT_WIDTH / view.width);
        canvas = new OffscreenCanvas(
          Math.round(view.width * scale),
          Math.round(pageHeight * ratio * scale),
        );
        ctx = canvas.getContext("2d");
      }
      const top = Math.round((y / pageHeight) * canvas.height);
      ctx?.drawImage(view, 0, top, canvas.width, Math.round(view.height * scale));
      view.close();
    }
  } finally {
    await inPage(tabId, restorePage, [HIDDEN_ATTR, metrics.scrollX, metrics.scrollY]).catch(
      () => undefined,
    );
  }
  if (!canvas) throw new Error("Could not capture the page.");
  const blob = await encode(canvas, maxBytes);
  return { blob, mime: "image/jpeg", width: canvas.width, height: canvas.height };
}

/** Just the visible part, for pages Acorn cannot script (the Web Store, chrome:// pages). */
export async function captureVisible(windowId: number): Promise<FullPageShot> {
  const view = await captureView(windowId);
  const canvas = new OffscreenCanvas(view.width, view.height);
  canvas.getContext("2d")?.drawImage(view, 0, 0);
  view.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITIES[0] });
  return { blob, mime: "image/jpeg", width: canvas.width, height: canvas.height };
}

/** A blob as base64, in chunks so a large image does not overflow the call stack. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
