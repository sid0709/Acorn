/**
 * Shows the person a field of the page from the sidebar: the page scrolls it to the middle of the window, and
 * a ring round it pulses and fades in the cursor's colors (`PAGE_INK`). It runs in the page's own world
 * (`chrome.scripting`), where the run's control list (`control-marks-page.ts`) still holds the field by its
 * id after the run; a page whose list is gone (it was loaded again) is scrolled to where the field was. It is
 * never used while a run works on the page: the run owns the scroll then, so the service worker refuses.
 */

import { CONTROL_MARKS_KEY } from "./control-marks-page";
import { PAGE_INK } from "./overlay";

/** How long the ring follows the field while the page scrolls to it, and how long it then fades (ms). */
export const SPOTLIGHT_FOLLOW_MS = 1_600;
export const SPOTLIGHT_FADE_MS = 450;
/** The ring's room round the field, its corners and its line (CSS pixels). */
const SPOTLIGHT_GAP_PX = 6;
const SPOTLIGHT_RADIUS_PX = 10;
const SPOTLIGHT_LINE_PX = 3;
/** The ring sits above everything a page can draw. */
const SPOTLIGHT_Z_INDEX = 2147483647;
/** Marks the ring's element, so a second request takes the first ring away. */
const SPOTLIGHT_ATTRIBUTE = "data-acorn-spotlight";

/** What the page did: rang the field, scrolled to where it was, or had nothing to show. */
export type SpotlightResult = "control" | "place" | "missing";

/** What the page is given: the field (`control`, an id of the control list) or a place on it (`y`, CSS pixels). */
export interface SpotlightArgs {
  key: string;
  control: string | null;
  y: number | null;
  ink: typeof PAGE_INK;
  followMs: number;
  fadeMs: number;
  gap: number;
  radius: number;
  line: number;
  z: number;
  attribute: string;
}

export function spotlightArgs(control: string | null, y: number | null): SpotlightArgs {
  return {
    key: CONTROL_MARKS_KEY,
    control,
    y,
    ink: PAGE_INK,
    followMs: SPOTLIGHT_FOLLOW_MS,
    fadeMs: SPOTLIGHT_FADE_MS,
    gap: SPOTLIGHT_GAP_PX,
    radius: SPOTLIGHT_RADIUS_PX,
    line: SPOTLIGHT_LINE_PX,
    z: SPOTLIGHT_Z_INDEX,
    attribute: SPOTLIGHT_ATTRIBUTE,
  };
}

/**
 * Runs in the page. `chrome.scripting` sends the function's text, so it uses nothing from outside it: every
 * value comes in `args`.
 */
export function spotlightInPage(args: SpotlightArgs): SpotlightResult {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const behavior: ScrollBehavior = still ? "auto" : "smooth";
  const list = (window as unknown as Record<string, unknown>)[args.key] as
    { els?: unknown } | undefined;
  const ref =
    args.control && list?.els instanceof Map
      ? (list.els.get(args.control) as WeakRef<Element> | undefined)
      : undefined;
  const field = ref?.deref();
  if (!field || !field.isConnected) {
    if (args.y == null) return "missing";
    window.scrollTo({ top: Math.max(0, args.y - window.innerHeight / 2), behavior });
    return "place";
  }
  field.scrollIntoView({ block: "center", inline: "nearest", behavior });
  for (const old of document.querySelectorAll(`[${args.attribute}]`)) old.remove();
  const host = document.createElement("div");
  host.setAttribute(args.attribute, "");
  const shadow = host.attachShadow({ mode: "closed" });
  // A constructed sheet, as the overlay's: a page's policy against inline styles does not stop it.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial; }
    .ring {
      position: fixed; left: 0; top: 0; box-sizing: border-box; pointer-events: none; z-index: ${args.z};
      border: ${args.line}px solid ${args.ink.body}; border-radius: ${args.radius}px;
      box-shadow: 0 0 0 2px ${args.ink.edge}, 0 0 0 4px ${args.ink.halo}, 0 0 22px 6px ${args.ink.body};
      animation: pulse 700ms ease-in-out 2; transition: opacity ${args.fadeMs}ms ease-out;
    }
    .ring.gone { opacity: 0; }
    @keyframes pulse { 0%, 100% { scale: 1; } 50% { scale: 1.035; } }
    @media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
  `);
  shadow.adoptedStyleSheets = [sheet];
  const ring = document.createElement("div");
  ring.className = "ring";
  shadow.append(ring);
  document.documentElement.append(host);
  const began = performance.now();
  const follow = () => {
    const rect = field.getBoundingClientRect();
    ring.style.left = `${rect.left - args.gap}px`;
    ring.style.top = `${rect.top - args.gap}px`;
    ring.style.width = `${rect.width + args.gap * 2}px`;
    ring.style.height = `${rect.height + args.gap * 2}px`;
    if (performance.now() - began < args.followMs) {
      requestAnimationFrame(follow);
      return;
    }
    ring.classList.add("gone");
    setTimeout(() => host.remove(), args.fadeMs);
  };
  follow();
  return "control";
}
