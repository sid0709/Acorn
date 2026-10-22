/**
 * Mouse and keyboard input as the browser itself delivers it: events the page cannot tell
 * from a person's. Coordinates here are CSS pixels in the page's viewport.
 */

import { charKey, keySequenceEvents } from "./keys";

import type { Cdp } from "./cdp";

/** Text up to this long is typed one key at a time, so a page that listens to keys hears them. */
export const KEYSTROKE_TEXT_MAX_CHARS = 240;
/**
 * The pause between one key and the next while typing, in ms: the least, and the most. Keys with no gap at
 * all are one of the things a page's spam filter weighs (a recorded application was refused as possible spam
 * after forty characters went in at once), so there is a gap, varying between the two bounds; it is a fast
 * typist's (2.9.0: it was 30 to 90 ms, a slow one's, and a page of answers took tens of seconds to type).
 */
export const KEY_INTERVAL_MIN_MS = 8;
export const KEY_INTERVAL_MAX_MS = 20;

/** A pause between keys, somewhere between the bounds. */
function keyInterval(): number {
  return KEY_INTERVAL_MIN_MS + Math.random() * (KEY_INTERVAL_MAX_MS - KEY_INTERVAL_MIN_MS);
}

/** Waits for a time; what typeText uses unless the caller brings its own (one that stops with the run). */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/** The most one wheel event scrolls; a longer scroll is sent as several. */
export const WHEEL_STEP_PX = 600;
/** The mouse buttons the agent uses. */
type Button = "left" | "right";

const MOUSE_BUTTON_BIT: Record<Button, number> = { left: 1, right: 2 };

export async function moveMouse(cdp: Cdp, x: number, y: number): Promise<void> {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    buttons: 0,
  });
}

/** Presses and releases a button `count` times at the point; count 2 is a double click. */
export async function clickAt(
  cdp: Cdp,
  x: number,
  y: number,
  options: { button?: Button; count?: number } = {},
): Promise<void> {
  const button = options.button ?? "left";
  const count = options.count ?? 1;
  await moveMouse(cdp, x, y);
  for (let clickCount = 1; clickCount <= count; clickCount += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      buttons: MOUSE_BUTTON_BIT[button],
      clickCount,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      buttons: 0,
      clickCount,
    });
  }
}

/** Scrolls with the mouse wheel at the point, in steps a page's scroll handlers can follow. */
export async function wheelAt(
  cdp: Cdp,
  x: number,
  y: number,
  dx: number,
  dy: number,
): Promise<void> {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / WHEEL_STEP_PX));
  for (let step = 0; step < steps; step += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: dx / steps,
      deltaY: dy / steps,
    });
  }
}

/** Presses keys: "Enter", "Control+a", "Tab Tab Enter". */
export async function pressKeys(cdp: Cdp, keys: string): Promise<void> {
  for (const event of keySequenceEvents(keys)) {
    await cdp.send("Input.dispatchKeyEvent", event);
  }
}

/**
 * Types text into the control that has focus. Short text goes in one key at a time, with a person's
 * pause between keys, so the page sees key, input, and key-up events as it does from a person (a
 * search that waits for typing, a masked field). Long text, and characters with no key of their own,
 * are inserted whole. `sleep` is the run's own wait, which ends when the person presses Stop.
 */
export async function typeText(
  cdp: Cdp,
  text: string,
  sleep: (ms: number) => Promise<void> = pause,
): Promise<void> {
  const typeable = [...text].length <= KEYSTROKE_TEXT_MAX_CHARS;
  let pending = "";
  let typedOne = false;
  const flush = async () => {
    if (pending) await cdp.send("Input.insertText", { text: pending });
    pending = "";
  };
  for (const char of text) {
    if (typeable && /^[\x20-\x7e]$/.test(char)) {
      await flush();
      if (typedOne) await sleep(keyInterval());
      typedOne = true;
      const info = charKey(char);
      const common = {
        key: info.key,
        code: info.code,
        windowsVirtualKeyCode: info.keyCode,
        modifiers: 0,
      };
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...common, text: char });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
    } else {
      pending += char;
    }
  }
  await flush();
}
