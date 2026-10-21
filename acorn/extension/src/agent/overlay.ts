/**
 * What the person sees on the page while the agent works: a glow around the edge of the
 * window, Acorn's glowing "A" cursor that glides to each point before it is clicked (with a
 * trail of sparks while it moves and a burst when it clicks), and a bar with a Stop button.
 * It is drawn by a script the debugger runs in the page, in a closed shadow root that ignores
 * the mouse (the Stop button excepted), and it is hidden for each screenshot so the model sees
 * the page, not the overlay.
 *
 * The cursor's shape, aura, sparks and motion are copied from the design demo (demo/demo.html):
 * the same outline and swoosh paths, glow, keyframes, particle physics and chase-and-tilt
 * motion. Its colors are not: the demo sits on a near-black page, where white and pale yellow
 * show, but on a light page they vanish and one orange cannot reach 3:1 (WCAG 1.4.11) against
 * both white and black. So the cursor is drawn the way operating systems draw theirs, in three
 * layers that need no knowledge of the page: a white halo, a very dark brown edge, and a
 * saturated amber body (dark edge on white 16:1, white halo on black 21:1, body on its edge
 * 6.9:1). The sparks blend normally, with a dark rim, and the bar is a fixed high-contrast pair.
 * The page is a foreign document where the design system's tokens do not exist, so these
 * colors are written out here, in this one module. With `forced-colors` the cursor and bar use
 * the system colors, and with `prefers-reduced-motion` there are no sparks and the glide is short.
 */

import type { Cdp } from "./cdp";

/** The binding the Stop button calls; the runner listens for it. */
export const OVERLAY_STOP_BINDING = "acornAgentStop";
/** Where the overlay's controller lives on the page's window. */
const OVERLAY_GLOBAL = "__acornAgentOverlay";
/** The overlay sits above everything a page can draw. */
const OVERLAY_Z_INDEX = 2147483647;
/** How close (CSS px) the gliding cursor must come to a point to count as there: the 44px cursor looks arrived. */
const CURSOR_ARRIVE_PX = 6;
/** The longest a move waits for the cursor to arrive (a background tab draws no frames). */
const CURSOR_ARRIVE_MAX_MS = 900;
/** How long the cursor stays pressed for a click: the demo's mouse-down to mouse-up. */
const CLICK_PRESS_MS = 140;
/** How long the overlay takes to fade back in after a screenshot. */
const CAPTURE_FADE_IN_MS = 180;
/**
 * The cursor's three layers, of which one contrasts with any page (above): a white halo, a very dark brown
 * edge, and the amber body. The field spotlight (`field-spotlight.ts`) draws its ring in them too.
 */
export const PAGE_INK = { halo: "#ffffff", edge: "#3b1500", body: "#ffb52e" } as const;

/** The cursor's drawn size (CSS px), and the square its artwork is drawn in (viewBox units). */
const CURSOR_SIZE_PX = 44;
const CURSOR_VIEWBOX = 100;
/** The artwork's pointed end (the top of the "A", in viewBox units) and the width of the dark ring drawn around its outline. */
const CURSOR_APEX = { x: 50, y: 14 };
const CURSOR_EDGE_STROKE = 15;
/**
 * Where the cursor's tip is inside its box (CSS px): the outer edge of the dark ring at the apex.
 * The tip, not the centre of the box, is the point the cursor stands for, so the box is placed and
 * turned about it: a click lands where the tip is drawn, whatever the cursor's tilt or size.
 */
export const CURSOR_TIP_PX = {
  x: Number(((CURSOR_APEX.x / CURSOR_VIEWBOX) * CURSOR_SIZE_PX).toFixed(2)),
  y: Number(
    (((CURSOR_APEX.y - CURSOR_EDGE_STROKE / 2) / CURSOR_VIEWBOX) * CURSOR_SIZE_PX).toFixed(2),
  ),
};

/**
 * Names the overlay a page holds: the build, and where its cursor's tip is. A page that already has an
 * overlay of another build (the extension was updated while the page stayed open, or a run left one
 * behind) has it taken off and the current one put on, instead of keeping the old cursor.
 */
const OVERLAY_VERSION = `${import.meta.env?.VITE_ACORN_VERSION ?? "dev"}:${CURSOR_TIP_PX.x},${CURSOR_TIP_PX.y}`;

const OVERLAY_CSS = `
  :host { all: initial; }
  .root { position: fixed; inset: 0; z-index: ${OVERLAY_Z_INDEX}; pointer-events: none; font: 13px/1.3 system-ui, sans-serif; opacity: 1; transition: opacity ${CAPTURE_FADE_IN_MS}ms ease-out; }
  .root.hidden { visibility: hidden; opacity: 0; transition: none; }
  @media (prefers-reduced-motion: reduce) { .glow, .cursor-aura { animation: none; } }
  .glow {
    position: absolute; inset: 0;
    box-shadow: inset 0 0 28px 6px color-mix(in srgb, orange 70%, transparent), inset 0 0 90px 10px color-mix(in srgb, orange 35%, transparent);
    animation: breathe 2.4s ease-in-out infinite;
  }
  @keyframes breathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }

  /* From demo/demo.html: the canvas for the sparks and warm glows. The demo blends them with
     "screen", which only brightens and so shows nothing on a light page; these blend normally. */
  #fx-canvas {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9998;
  }

  /* Fixed Origin Container - Only handles position (X, Y) */
  .cursor-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    pointer-events: none;
    z-index: 9999;
    will-change: transform;
    opacity: 0;
    transition: opacity ${CAPTURE_FADE_IN_MS}ms ease-out;
  }
  .cursor-container.shown { opacity: 1; }

  /* Inner body: its tip is the container's (0,0), the point the cursor stands for, and it turns and scales about the tip. */
  .cursor-rotator {
    position: absolute;
    top: 0;
    left: 0;
    width: ${CURSOR_SIZE_PX}px;
    height: ${CURSOR_SIZE_PX}px;
    margin-left: -${CURSOR_TIP_PX.x}px;
    margin-top: -${CURSOR_TIP_PX.y}px;
    transform-origin: ${CURSOR_TIP_PX.x}px ${CURSOR_TIP_PX.y}px;
    will-change: transform;
    filter: drop-shadow(0 0 16px rgba(255, 170, 0, 0.95))
            drop-shadow(0 0 35px rgba(255, 100, 0, 0.65));
    transition: scale 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  /* Soft Core Glow Behind the 'A' */
  .cursor-aura {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 80px;
    height: 80px;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, rgba(255, 220, 100, 0.5) 0%, rgba(255, 130, 0, 0.25) 45%, transparent 70%);
    border-radius: 50%;
    filter: blur(10px);
    pointer-events: none;
    animation: pulseAura 2.2s infinite alternate ease-in-out;
  }

  @keyframes pulseAura {
    0% { transform: translate(-50%, -50%) scale(0.9); opacity: 0.7; }
    100% { transform: translate(-50%, -50%) scale(1.25); opacity: 1; }
  }

  /* Acorn 'A' SVG Icon */
  .acorn-svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  /* Clean state transitions without displacing the center */
  .cursor-container.hovering .cursor-rotator {
    scale: 1.3;
    filter: drop-shadow(0 0 16px #ffe484) drop-shadow(0 0 28px #ff9d00);
  }

  .cursor-container.clicking .cursor-rotator {
    scale: 0.85;
  }

  /* A fixed pair, whatever the page: white on near-black is 17:1, and the light border and
     the dark ring give the pill an edge on both a light and a dark page. */
  .bar {
    position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 10000;
    display: flex; align-items: center; gap: 10px; padding: 7px 8px 7px 14px;
    border-radius: 999px; background: #1c1410; color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.6);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 4px 18px rgba(0, 0, 0, 0.4);
    max-width: min(560px, calc(100vw - 40px)); pointer-events: none;
  }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Only the Stop button takes clicks: the bar lies over the bottom of the page, and a click the run aims
     there (a box at the window's edge) must reach the page, not the bar. A recorded run's five clicks on a
     required box at the bottom of the window landed on the bar, and nothing was typed. */
  .stop {
    all: unset; cursor: pointer; padding: 4px 12px; border-radius: 999px; font-weight: 600;
    background: #ffffff; color: #1c1410; pointer-events: auto;
  }
  .stop:hover { background: #ffe1b0; }
  .stop:focus-visible { outline: 2px solid #ffb52e; outline-offset: 2px; }

  /* The person's own high-contrast colors win over ours. */
  @media (forced-colors: active) {
    .cursor-rotator, .cursor-container.hovering .cursor-rotator { filter: none; }
    .cursor-aura { display: none; }
    .halo { fill: Canvas; stroke: Canvas; }
    .edge { fill: CanvasText; stroke: CanvasText; }
    .body { fill: Highlight; stroke: Highlight; }
    .swoosh { stroke: CanvasText; }
    .bar { background: Canvas; color: CanvasText; border: 1px solid CanvasText; box-shadow: none; }
    .stop { background: ButtonFace; color: ButtonText; border: 1px solid ButtonText; }
  }
`;

/**
 * The page-side controller, as a script. It builds the overlay without innerHTML (a page
 * may forbid it) and its stylesheet without a style element (a page's CSP may forbid
 * that), and calling it again on a page that has it only reconnects it.
 *
 * The cursor's motion is the demo's: every frame the cursor moves a fifth of the way to its
 * target, tilts with its smoothed sideways speed (at most 45 degrees), and sheds sparks when
 * it moves; a click presses it and bursts 45 sparks. moveTo resolves when it has arrived.
 */
export const OVERLAY_SCRIPT = `(() => {
  const NAME = ${JSON.stringify(OVERLAY_GLOBAL)};
  const STOP = ${JSON.stringify(OVERLAY_STOP_BINDING)};
  const ARRIVE_PX = ${CURSOR_ARRIVE_PX};
  const ARRIVE_MAX_MS = ${CURSOR_ARRIVE_MAX_MS};
  const PRESS_MS = ${CLICK_PRESS_MS};
  const VERSION = ${JSON.stringify(OVERLAY_VERSION)};
  const existing = window[NAME];
  if (existing && existing.version === VERSION) { existing.attach(); return true; }
  if (existing) { try { existing.remove(); } catch (e) { /* an overlay of another build that cannot be removed is replaced */ } }
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
  const SVG_NS = "http://www.w3.org/2000/svg";
  const svgNode = (tag, attributes) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key in attributes) node.setAttribute(key, attributes[key]);
    return node;
  };
  const root = make("div", "root");
  const glow = make("div", "glow");

  // From demo/demo.html: <canvas id="fx-canvas">.
  const canvas = make("canvas");
  canvas.id = "fx-canvas";

  // From demo/demo.html: the virtual Acorn "A" cursor.
  const cursor = make("div", "cursor-container");
  const rotator = make("div", "cursor-rotator");
  const aura = make("div", "cursor-aura");
  const svg = svgNode("svg", { class: "acorn-svg", viewBox: "0 0 ${CURSOR_VIEWBOX} ${CURSOR_VIEWBOX}", fill: "none" });
  const defs = svgNode("defs", {});
  const acornGrad = svgNode("linearGradient", { id: "acornGrad", x1: "0%", y1: "0%", x2: "100%", y2: "100%" });
  acornGrad.append(
    svgNode("stop", { offset: "0%", "stop-color": "#ffc23d" }),
    svgNode("stop", { offset: "35%", "stop-color": "${PAGE_INK.body}" }),
    svgNode("stop", { offset: "85%", "stop-color": "#ff8a00" }),
    svgNode("stop", { offset: "100%", "stop-color": "#ff6a00" }),
  );
  const innerGlow = svgNode("linearGradient", { id: "innerGlow", x1: "50%", y1: "0%", x2: "50%", y2: "100%" });
  innerGlow.append(
    svgNode("stop", { offset: "0%", "stop-color": "#ffc84a" }),
    svgNode("stop", { offset: "100%", "stop-color": "#ff8f10" }),
  );
  defs.append(acornGrad, innerGlow);
  // Outer organic A outline (the demo's path), drawn three times: a white halo, a very dark
  // brown edge, and the amber body, so one of the rings contrasts with any page.
  const OUTLINE = "M ${CURSOR_APEX.x} ${CURSOR_APEX.y} C 62 14, 76 36, 83 62 C 89 82, 79 88, 66 84 C 56 80, 53 66, 50 66 C 47 66, 44 80, 34 84 C 21 88, 11 82, 17 62 C 24 36, 38 14, ${CURSOR_APEX.x} ${CURSOR_APEX.y} Z";
  const ring = (className, color, width) => svgNode("path", {
    class: className, d: OUTLINE, fill: color, stroke: color, "stroke-width": width, "stroke-linejoin": "round",
  });
  const halo = ring("halo", "${PAGE_INK.halo}", "21");
  const edge = ring("edge", "${PAGE_INK.edge}", "${CURSOR_EDGE_STROKE}");
  const body = svgNode("path", {
    class: "body",
    d: OUTLINE,
    stroke: "url(#acornGrad)",
    "stroke-width": "7",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    fill: "url(#innerGlow)",
  });
  // Inner swoosh (the demo's path), dark so the A's bar reads against the amber body.
  const swoosh = svgNode("path", {
    class: "swoosh",
    d: "M 39 63 C 44 51, 56 51, 61 63",
    stroke: "${PAGE_INK.edge}",
    "stroke-width": "6.5",
    "stroke-linecap": "round",
  });
  svg.append(defs, halo, edge, body, swoosh);
  rotator.append(aura, svg);
  cursor.appendChild(rotator);

  const bar = make("div", "bar");
  const label = make("span", "label", "Acorn is working on this page");
  const stop = make("button", "stop", "Stop");
  stop.addEventListener("click", (event) => {
    event.stopPropagation();
    const call = window[STOP];
    if (typeof call === "function") call("stop");
  });
  bar.append(label, stop);
  root.append(glow, canvas, cursor, bar);
  shadow.appendChild(root);

  // From demo/demo.html: the canvas, sized to the window.
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);
  const onResize = () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  };
  if (window.addEventListener) window.addEventListener("resize", onResize);

  // The demo's mouse is the point the agent is about to act on.
  const mouse = { x: width / 2, y: height / 2 };

  // Virtual cursor tracking
  const virtual = {
    x: width / 2,
    y: height / 2,
    vx: 0,
    vy: 0,
    smoothVx: 0, // Low-pass filtered velocity to eliminate micro-jitter
    angle: 0,
  };

  // ==========================================
  // Unified Natural Particle System
  // ==========================================
  const particles = [];

  class Particle {
    constructor(x, y, isClick = false) {
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.random() * (isClick ? 14 : 7);
      this.x = x + Math.cos(angle) * spread;
      this.y = y + Math.sin(angle) * spread;

      if (isClick) {
        const speed = Math.random() * 4.2 + 0.8;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed - 0.4;
        this.size = Math.random() * 4.5 + 2.0;
        this.decay = Math.random() * 0.018 + 0.012;
      } else {
        this.vx = (Math.random() - 0.5) * 2.0;
        this.vy = (Math.random() - 0.5) * 2.0 - 0.5;
        this.size = Math.random() * 3.8 + 1.2;
        this.decay = Math.random() * 0.024 + 0.014;
      }

      this.life = 1.0;
      this.airResistance = 0.96;
      this.gravity = -0.035;

      // Saturated oranges only: the demo's cream spark disappears on a light page.
      const colors = [
        "255, 190, 40",
        "255, 150, 20",
        "255, 110, 0",
        "255, 80, 0",
      ];
      this.color = colors[Math.floor(Math.random() * colors.length)];
    }

    update() {
      this.vx *= this.airResistance;
      this.vy *= this.airResistance;
      this.vy += this.gravity;

      this.x += this.vx;
      this.y += this.vy;

      this.life -= this.decay;
      this.size *= 0.985;
    }

    draw(context) {
      if (this.life <= 0 || this.size <= 0.2) return;

      context.save();
      context.beginPath();
      context.arc(this.x, this.y, Math.max(this.size, 0.1), 0, Math.PI * 2);

      context.shadowColor = "rgba(" + this.color + ", 0.85)";
      context.shadowBlur = 12;
      context.fillStyle = "rgba(" + this.color + ", " + Math.max(this.life * 0.85, 0) + ")";
      context.fill();
      // A thin dark rim, so a spark shows on a light page as well as a dark one.
      context.shadowBlur = 0;
      context.lineWidth = 0.8;
      context.strokeStyle = "rgba(59, 21, 0, " + Math.max(this.life * 0.6, 0) + ")";
      context.stroke();
      context.restore();
    }
  }

  // The person asked their system for less motion: no sparks, and a short glide.
  const reduced = Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const chase = reduced ? 0.45 : 0.2;

  function spawnParticles(x, y, count, isClick = false) {
    if (reduced) return;
    for (let i = 0; i < count; i++) {
      if (particles.length < 500) {
        particles.push(new Particle(x, y, isClick));
      }
    }
  }

  // Moves waiting for the cursor to arrive.
  let arrivals = [];
  const settle = (all) => {
    const now = Date.now();
    arrivals = arrivals.filter((wait) => {
      const there = Math.hypot(mouse.x - virtual.x, mouse.y - virtual.y) <= ARRIVE_PX;
      if (all || there || now >= wait.until) { wait.done(); return false; }
      return true;
    });
  };

  // ==========================================
  // Render & Physics Loop
  // ==========================================
  let frame = 0;
  function animate() {
    const prevX = virtual.x;
    const prevY = virtual.y;

    // 1. Virtual cursor chases mouse
    virtual.x += (mouse.x - virtual.x) * chase;
    virtual.y += (mouse.y - virtual.y) * chase;

    virtual.vx = virtual.x - prevX;
    virtual.vy = virtual.y - prevY;

    // 2. Filter velocity to eliminate micro-hand-shivering
    virtual.smoothVx += (virtual.vx - virtual.smoothVx) * 0.18;

    // 3. Smooth "Look Left / Look Right" rotation:
    // Sensitive even at low speeds, caps comfortably at ±45 degrees,
    // completely stable with zero center displacement.
    const targetAngle = Math.max(-45, Math.min(45, virtual.smoothVx * 4.2));

    // Critically damped smooth transition back to 0° (upright)
    virtual.angle += (targetAngle - virtual.angle) * 0.12;

    // Outer container locks strictly to virtual (x,y)
    cursor.style.transform = "translate3d(" + virtual.x + "px, " + virtual.y + "px, 0)";

    // Inner rotator turns about the cursor's tip, so the tip stays on the point
    rotator.style.transform = "rotate(" + virtual.angle + "deg)";

    // Particles spawn exactly from the cursor's tip
    const speed = Math.hypot(virtual.vx, virtual.vy);
    if (speed > 0.8) {
      const particleCount = Math.min(Math.floor(speed * 0.85) + 1, 6);
      spawnParticles(virtual.x, virtual.y, particleCount, false);
    }

    // Draw graphics
    if (ctx) {
      ctx.clearRect(0, 0, width, height);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update();
        p.draw(ctx);
        if (p.life <= 0 || p.size <= 0.2) {
          particles.splice(i, 1);
        }
      }
    }

    settle(false);
    frame = requestAnimationFrame(animate);
  }

  const controller = {
    version: VERSION,
    attach() {
      const parent = document.documentElement;
      if (parent && !host.isConnected) parent.appendChild(host);
    },
    setLabel(text) { label.textContent = text; },
    // Puts the cursor where it was on the page before, without a glide: a new page carries on
    // from the last point instead of from the middle of the window.
    place(x, y) {
      if (cursor.classList.contains("shown")) return;
      mouse.x = virtual.x = x;
      mouse.y = virtual.y = y;
      cursor.classList.add("shown");
    },
    // Glides the cursor to a point and resolves once it is there.
    moveTo(x, y) {
      cursor.classList.add("shown");
      cursor.classList.remove("hovering");
      mouse.x = x;
      mouse.y = y;
      // A tab that is not shown draws no frames, so the cursor would never glide: it is placed and
      // the move is done, not waited for (up to ARRIVE_MAX_MS for every point of every plan).
      if (document.visibilityState === "hidden") {
        virtual.x = x;
        virtual.y = y;
        return Promise.resolve();
      }
      return new Promise((done) => {
        arrivals.push({ done, until: Date.now() + ARRIVE_MAX_MS });
        setTimeout(() => settle(false), ARRIVE_MAX_MS);
      });
    },
    // From the demo's mousedown and mouseup.
    click() {
      cursor.classList.add("clicking");
      spawnParticles(virtual.x, virtual.y, 45, true);
      setTimeout(() => cursor.classList.remove("clicking"), PRESS_MS);
    },
    hover(on) { cursor.classList.toggle("hovering", on); },
    capture(on) { root.classList.toggle("hidden", on); },
    remove() {
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      if (window.removeEventListener) window.removeEventListener("resize", onResize);
      settle(true);
      host.remove();
      delete window[NAME];
    },
  };
  Object.defineProperty(window, NAME, { value: controller, configurable: true });
  controller.attach();
  if (typeof requestAnimationFrame === "function") animate();
  return true;
})()`;

/** Drives the overlay from the extension. Nothing here may fail a run: the page still works without it. */
export class Overlay {
  private scriptId: string | null = null;
  /** Where the cursor last went, so a new page shows it there instead of in the middle. */
  private last: { x: number; y: number } | null = null;

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
    const calls = [
      label ? `window.${OVERLAY_GLOBAL}.setLabel(${JSON.stringify(label)})` : "",
      this.last ? `window.${OVERLAY_GLOBAL}.place(${this.last.x}, ${this.last.y})` : "",
    ].filter(Boolean);
    await this.run([OVERLAY_SCRIPT, ...calls].join("; "));
  }

  async setLabel(label: string): Promise<void> {
    await this.run(
      `window.${OVERLAY_GLOBAL} && window.${OVERLAY_GLOBAL}.setLabel(${JSON.stringify(label)})`,
    );
  }

  /** Glides the cursor to a point of the page (CSS pixels) and waits until it is there. */
  async moveTo(x: number, y: number): Promise<void> {
    this.last = { x, y };
    // The page resolves the move once the cursor arrives, or after CURSOR_ARRIVE_MAX_MS.
    await this.run(`window.${OVERLAY_GLOBAL} && window.${OVERLAY_GLOBAL}.moveTo(${x}, ${y})`, true);
  }

  /** Presses the cursor and bursts sparks from it. */
  async click(): Promise<void> {
    await this.run(`window.${OVERLAY_GLOBAL} && window.${OVERLAY_GLOBAL}.click()`);
  }

  /** Grows the cursor while it rests on a point it hovers. */
  async hover(on: boolean): Promise<void> {
    await this.run(`window.${OVERLAY_GLOBAL} && window.${OVERLAY_GLOBAL}.hover(${on})`);
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

  /** Runs an expression on the page; with awaitPromise it also waits for the promise it returns. */
  private async run(expression: string, awaitPromise = false): Promise<void> {
    try {
      await this.cdp.send(
        "Runtime.evaluate",
        awaitPromise ? { expression, awaitPromise: true } : { expression },
      );
    } catch {
      // A page that is mid-navigation has nothing to draw on yet.
    }
  }
}
