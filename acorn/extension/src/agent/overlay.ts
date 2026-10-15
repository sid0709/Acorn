/**
 * What the person sees on the page while the agent works: a glow around the edge of the
 * window, a cursor that moves to each point before it is clicked, and a bar with a Stop
 * button. It is drawn by a script the debugger runs in the page, in a closed shadow root
 * that ignores the mouse (the Stop button excepted), and it is hidden for each screenshot
 * so the model sees the page, not the overlay.
 *
 * The page is a foreign document, so the design system's tokens do not exist there: the
 * colors are CSS keywords and `color-mix` of them, never a hex or rgb value, and they
 * follow the page's own light or dark scheme.
 */

import type { Cdp } from "./cdp";

/** The binding the Stop button calls; the runner listens for it. */
export const OVERLAY_STOP_BINDING = "acornAgentStop";
/** Where the overlay's controller lives on the page's window. */
const OVERLAY_GLOBAL = "__acornAgentOverlay";
/** How long the cursor takes to glide to a point, so the person can follow it. */
export const CURSOR_GLIDE_MS = 280;
/** The overlay sits above everything a page can draw. */
const OVERLAY_Z_INDEX = 2147483647;

const OVERLAY_CSS = `
  :host { all: initial; }
  .root { position: fixed; inset: 0; z-index: ${OVERLAY_Z_INDEX}; pointer-events: none; font: 13px/1.3 system-ui, sans-serif; }
  .root.hidden { visibility: hidden; }
  .glow {
    position: absolute; inset: 0;
    box-shadow: inset 0 0 28px 6px color-mix(in srgb, orange 70%, transparent), inset 0 0 90px 10px color-mix(in srgb, orange 35%, transparent);
    animation: breathe 2.4s ease-in-out infinite;
  }
  @keyframes breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
  .cursor { position: absolute; left: 0; top: 0; width: 22px; height: 22px; opacity: 0; transition: transform ${CURSOR_GLIDE_MS}ms cubic-bezier(0.22, 0.8, 0.3, 1), opacity 160ms; will-change: transform; }
  .cursor.on { opacity: 1; }
  .ripple { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; border: 2px solid orange; opacity: 0; }
  .ripple.go { animation: ripple 520ms ease-out; }
  @keyframes ripple { 0% { opacity: 0.9; transform: scale(1); } 100% { opacity: 0; transform: scale(5); } }
  .bar {
    position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 10px; padding: 7px 8px 7px 14px;
    border-radius: 999px; background: Canvas; color: CanvasText;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    box-shadow: 0 4px 18px color-mix(in srgb, CanvasText 25%, transparent);
    max-width: min(560px, calc(100vw - 40px)); pointer-events: auto;
  }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stop {
    all: unset; cursor: pointer; padding: 4px 12px; border-radius: 999px; font-weight: 600;
    background: color-mix(in srgb, CanvasText 10%, Canvas); color: CanvasText;
  }
  .stop:hover { background: color-mix(in srgb, CanvasText 20%, Canvas); }
`;

/**
 * The page-side controller, as a script. It builds the overlay without innerHTML (a page
 * may forbid it) and its stylesheet without a style element (a page's CSP may forbid
 * that), and calling it again on a page that has it only reconnects it.
 */
export const OVERLAY_SCRIPT = `(() => {
  const NAME = ${JSON.stringify(OVERLAY_GLOBAL)};
  const STOP = ${JSON.stringify(OVERLAY_STOP_BINDING)};
  const existing = window[NAME];
  if (existing) { existing.attach(); return true; }
  const host = document.createElement("div");
  host.setAttribute("data-acorn-agent-overlay", "");
  const shadow = host.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(${JSON.stringify(OVERLAY_CSS)});
  shadow.adoptedStyleSheets = [sheet];
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const root = make("div", "root");
  const glow = make("div", "glow");
  const cursor = make("div", "cursor");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 22 22");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrow.setAttribute("d", "M2 1 L2 17 L6.5 13 L9.5 20 L12.5 18.8 L9.6 12 L15.5 12 Z");
  arrow.setAttribute("fill", "black");
  arrow.setAttribute("stroke", "white");
  arrow.setAttribute("stroke-width", "1.4");
  arrow.setAttribute("stroke-linejoin", "round");
  svg.appendChild(arrow);
  cursor.appendChild(svg);
  const ripple = make("div", "ripple");
  const bar = make("div", "bar");
  const label = make("span", "label", "Acorn is working on this page");
  const stop = make("button", "stop", "Stop");
  stop.addEventListener("click", (event) => {
    event.stopPropagation();
    const call = window[STOP];
    if (typeof call === "function") call("stop");
  });
  bar.append(label, stop);
  root.append(glow, ripple, cursor, bar);
  shadow.appendChild(root);
  const controller = {
    attach() {
      const parent = document.documentElement;
      if (parent && !host.isConnected) parent.appendChild(host);
    },
    setLabel(text) { label.textContent = text; },
    moveTo(x, y) {
      cursor.classList.add("on");
      cursor.style.transform = "translate(" + x + "px," + y + "px)";
      ripple.style.left = x + "px";
      ripple.style.top = y + "px";
    },
    click() { ripple.classList.remove("go"); void ripple.offsetWidth; ripple.classList.add("go"); },
    capture(on) { root.classList.toggle("hidden", on); },
    remove() { host.remove(); delete window[NAME]; },
  };
  Object.defineProperty(window, NAME, { value: controller, configurable: true });
  controller.attach();
  return true;
})()`;

/** Drives the overlay from the extension. Nothing here may fail a run: the page still works without it. */
export class Overlay {
  private scriptId: string | null = null;

  constructor(private readonly cdp: Cdp) {}

  /** Makes the overlay appear on this page and on every page the tab loads next. */
  async start(label: string): Promise<void> {
    try {
      await this.cdp.send("Runtime.addBinding", { name: OVERLAY_STOP_BINDING });
      const added = await this.cdp.send<{ identifier: string }>(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source: OVERLAY_SCRIPT,
        },
      );
      this.scriptId = added.identifier;
    } catch {
      // The overlay is for the person's eyes only.
    }
    await this.ensure(label);
  }

  /** Puts the overlay back on a page that was replaced, and says what the agent is doing. */
  async ensure(label?: string): Promise<void> {
    await this.run(
      `${OVERLAY_SCRIPT}${label ? `; window.${OVERLAY_GLOBAL}.setLabel(${JSON.stringify(label)})` : ""}`,
    );
  }

  async setLabel(label: string): Promise<void> {
    await this.run(
      `window.${OVERLAY_GLOBAL} && window.${OVERLAY_GLOBAL}.setLabel(${JSON.stringify(label)})`,
    );
  }

  /** Glides the cursor to a point of the page (CSS pixels). */
  async moveTo(x: number, y: number): Promise<void> {
    await this.run(`window.${OVERLAY_GLOBAL} && window.${OVERLAY_GLOBAL}.moveTo(${x}, ${y})`);
  }

  async click(): Promise<void> {
    await this.run(`window.${OVERLAY_GLOBAL} && window.${OVERLAY_GLOBAL}.click()`);
  }

  /** Hides the overlay while a screenshot is taken, and shows it again after. */
  async hideForCapture(hidden: boolean): Promise<void> {
    await this.run(`window.${OVERLAY_GLOBAL} && window.${OVERLAY_GLOBAL}.capture(${hidden})`);
  }

  /** Takes the overlay off the page. */
  async stop(): Promise<void> {
    if (this.scriptId) {
      await this.cdp
        .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: this.scriptId })
        .catch(() => undefined);
      this.scriptId = null;
    }
    await this.run(`window.${OVERLAY_GLOBAL} && window.${OVERLAY_GLOBAL}.remove()`);
  }

  private async run(expression: string): Promise<void> {
    try {
      await this.cdp.send("Runtime.evaluate", { expression });
    } catch {
      // A page that is mid-navigation has nothing to draw on yet.
    }
  }
}
