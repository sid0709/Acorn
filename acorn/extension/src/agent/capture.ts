/**
 * What the agent sees: a screenshot of the visible page. Its size is chosen here, and the
 * model's coordinates are in the screenshot's pixels, so the scale from screenshot to page
 * travels with the shot.
 */

import type { Cdp } from "./cdp";
import type { AgentViewport } from "@acorn/shared/agent-contract";

/** The widest screenshot sent; a wider page is shrunk to this so the model reads it cheaply. */
export const SHOT_MAX_WIDTH = 1280;
/** JPEG quality of a screenshot: text stays legible, the upload stays small. */
export const SHOT_QUALITY = 70;
/** How long a screenshot may take before the tab is brought forward and asked again. */
export const SHOT_TIMEOUT_MS = 8_000;

export interface Shot {
  /** The screenshot as a data URL. */
  dataUrl: string;
  viewport: AgentViewport;
  /** Screenshot pixels per CSS pixel; an action's point divided by it is a point on the page. */
  scale: number;
}

type LayoutMetrics = {
  cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
  cssContentSize: { width: number; height: number };
};

/** Rejects when `work` takes longer than `ms`. */
function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} took longer than ${ms / 1000} seconds`)),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Pixels of a JPEG, read from its header; null when the header cannot be read. */
export function jpegSize(base64: string): { width: number; height: number } | null {
  // The size is in the first frame header, near the start: 64 KB of image is more than enough.
  const head = base64.slice(0, 87_384);
  let bytes: string;
  try {
    bytes = atob(head.slice(0, head.length - (head.length % 4)));
  } catch {
    return null;
  }
  const at = (i: number) => bytes.charCodeAt(i);
  if (at(0) !== 0xff || at(1) !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (at(i) !== 0xff) {
      i += 1;
      continue;
    }
    const marker = at(i + 1);
    // A frame header (not DHT, JPG or DAC) holds the height and width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (at(i + 5) << 8) | at(i + 6), width: (at(i + 7) << 8) | at(i + 8) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + ((at(i + 2) << 8) | at(i + 3));
  }
  return null;
}

/** Device pixels per CSS pixel (a Retina screen, or a zoomed page, has more than one). */
async function devicePixelRatio(cdp: Cdp): Promise<number> {
  try {
    const answer = await cdp.send<{ result?: { value?: number } }>("Runtime.evaluate", {
      expression: "window.devicePixelRatio",
      returnByValue: true,
    });
    const ratio = answer.result?.value;
    return typeof ratio === "number" && ratio > 0 ? ratio : 1;
  } catch {
    return 1;
  }
}

async function shoot(cdp: Cdp): Promise<Shot> {
  const metrics = await cdp.send<LayoutMetrics>("Page.getLayoutMetrics");
  const { pageX, pageY, clientWidth, clientHeight } = metrics.cssVisualViewport;
  if (!(clientWidth > 0) || !(clientHeight > 0)) throw new Error("the page has no visible area");
  const wanted = Math.min(1, SHOT_MAX_WIDTH / clientWidth);
  // The clip's scale multiplies device pixels: on a screen with 2 device pixels to a CSS
  // pixel the image comes out twice as large as asked unless it is divided out.
  const ratio = await devicePixelRatio(cdp);
  const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", {
    format: "jpeg",
    quality: SHOT_QUALITY,
    clip: { x: pageX, y: pageY, width: clientWidth, height: clientHeight, scale: wanted / ratio },
    captureBeyondViewport: false,
  });
  // What the model sees is the image as it is, so its size, not the size asked for, defines
  // the pixels every coordinate is in.
  const size = jpegSize(shot.data) ?? {
    width: Math.round(clientWidth * wanted),
    height: Math.round(clientHeight * wanted),
  };
  const scale = size.width / clientWidth;
  return {
    dataUrl: `data:image/jpeg;base64,${shot.data}`,
    scale,
    viewport: {
      width: size.width,
      height: size.height,
      scrollX: pageX * scale,
      scrollY: pageY * scale,
      pageWidth: Math.max(metrics.cssContentSize.width, clientWidth) * scale,
      pageHeight: Math.max(metrics.cssContentSize.height, clientHeight) * scale,
    },
  };
}

/**
 * Takes the screenshot. A tab in the background may not draw frames, so a shot that does
 * not come is asked for again with the tab brought forward.
 */
/** Whether the tab is not shown (a background tab draws no frames, so its screenshots and cursor wait). */
export async function isTabHidden(cdp: Cdp): Promise<boolean> {
  try {
    const answer = await cdp.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      expression: `document.visibilityState === "hidden"`,
      returnByValue: true,
    });
    return answer.result?.value === true;
  } catch {
    return false;
  }
}

export async function captureShot(cdp: Cdp): Promise<Shot> {
  try {
    return await within(shoot(cdp), SHOT_TIMEOUT_MS, "the screenshot");
  } catch (err) {
    await cdp.send("Page.bringToFront").catch(() => undefined);
    try {
      return await within(shoot(cdp), SHOT_TIMEOUT_MS, "the screenshot");
    } catch {
      throw err;
    }
  }
}
