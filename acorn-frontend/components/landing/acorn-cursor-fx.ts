/** The glowing acorn cursor and its sparkles: a virtual cursor that chases the mouse, turns toward
 *  the way it is moving, and sheds warm particles on a canvas. Ported from the demo as it was. */

/** Tuning, as in the demo. */
const FX = {
  chase: 0.2,
  velocityFilter: 0.18,
  turnPerPixel: 4.2,
  maxTurnDegrees: 45,
  turnEase: 0.12,
  trailMinSpeed: 0.8,
  trailPerSpeed: 0.85,
  trailMaxPerFrame: 6,
  clickBurst: 45,
  maxParticles: 500,
  airResistance: 0.96,
  gravity: -0.035,
  shrink: 0.985,
  glowBlur: 12,
  fillAlpha: 0.85,
  trail: {
    spread: 7,
    drift: 2.0,
    lift: 0.5,
    size: 3.8,
    minSize: 1.2,
    decay: 0.024,
    minDecay: 0.014,
  },
  click: {
    spread: 14,
    speed: 4.2,
    minSpeed: 0.8,
    lift: 0.4,
    size: 4.5,
    minSize: 2.0,
    decay: 0.018,
    minDecay: 0.012,
  },
  minSize: 0.2,
} as const;

/** The four sparkle colors, palest to deepest: sid-ui tokens the landing page registers as colors. */
const SPARKLE_TOKENS = [
  "--lp-orange-soft",
  "--lp-amber",
  "--lp-orange",
  "--lp-orange-deep",
] as const;

const CLASS_CLICKING = "clicking";
const CLASS_HOVERING = "hovering";
const CLASS_LIVE = "live";
/** What the cursor swells over, as the demo's hover targets did. */
const HOVER_TARGETS = "a, button, [role='button'], summary, label, input, select, textarea";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  decay: number;
  life: number;
  color: string;
};

export type CursorFxParts = {
  /** The element placed at the cursor's position. */
  cursor: HTMLElement;
  /** The element that turns around the cursor's center. */
  rotator: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Where the sparkle colors are read from (the landing root). */
  theme: HTMLElement;
};

function spawn(
  particles: Particle[],
  colors: string[],
  x: number,
  y: number,
  isClick: boolean,
): Particle {
  const angle = Math.random() * Math.PI * 2;
  const tune = isClick ? FX.click : FX.trail;
  const spread = Math.random() * tune.spread;
  const px = x + Math.cos(angle) * spread;
  const py = y + Math.sin(angle) * spread;
  let vx: number;
  let vy: number;
  let size: number;
  let decay: number;
  if (isClick) {
    const speed = Math.random() * FX.click.speed + FX.click.minSpeed;
    vx = Math.cos(angle) * speed;
    vy = Math.sin(angle) * speed - FX.click.lift;
    size = Math.random() * FX.click.size + FX.click.minSize;
    decay = Math.random() * FX.click.decay + FX.click.minDecay;
  } else {
    vx = (Math.random() - 0.5) * FX.trail.drift;
    vy = (Math.random() - 0.5) * FX.trail.drift - FX.trail.lift;
    size = Math.random() * FX.trail.size + FX.trail.minSize;
    decay = Math.random() * FX.trail.decay + FX.trail.minDecay;
  }
  const particle: Particle = {
    x: px,
    y: py,
    vx,
    vy,
    size,
    decay,
    life: 1,
    color: colors[Math.floor(Math.random() * colors.length)],
  };
  particles.push(particle);
  return particle;
}

function draw(ctx: CanvasRenderingContext2D, p: Particle): void {
  if (p.life <= 0 || p.size <= FX.minSize) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(p.size, 0.1), 0, Math.PI * 2);
  ctx.shadowColor = p.color;
  ctx.shadowBlur = FX.glowBlur;
  ctx.globalAlpha = Math.max(p.life * FX.fillAlpha, 0);
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.restore();
}

/** Starts the effect and returns the function that stops it and removes every listener. */
export function startCursorFx({ cursor, rotator, canvas, theme }: CursorFxParts): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => undefined;

  const style = getComputedStyle(theme);
  const colors = SPARKLE_TOKENS.map((token) => style.getPropertyValue(token).trim()).filter(
    Boolean,
  );
  if (colors.length === 0) return () => undefined;

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);
  const mouse = { x: width / 2, y: height / 2 };
  const virtual = { x: mouse.x, y: mouse.y, vx: 0, vy: 0, smoothVx: 0, angle: 0 };
  const particles: Particle[] = [];
  let seen = false;
  let frame = 0;

  const burst = (count: number, isClick: boolean) => {
    for (let i = 0; i < count; i++) {
      if (particles.length < FX.maxParticles)
        spawn(particles, colors, virtual.x, virtual.y, isClick);
    }
  };

  const onResize = () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  };
  const onMove = (e: MouseEvent) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (!seen) {
      // The first move puts the cursor under the pointer instead of gliding in from the middle.
      seen = true;
      virtual.x = mouse.x;
      virtual.y = mouse.y;
      cursor.classList.add(CLASS_LIVE);
    }
  };
  const onDown = () => {
    cursor.classList.add(CLASS_CLICKING);
    burst(FX.clickBurst, true);
  };
  const onUp = () => cursor.classList.remove(CLASS_CLICKING);
  const onOver = (e: MouseEvent) => {
    const hit = e.target instanceof Element && e.target.closest(HOVER_TARGETS);
    cursor.classList.toggle(CLASS_HOVERING, Boolean(hit));
  };

  const animate = () => {
    const prevX = virtual.x;
    const prevY = virtual.y;
    virtual.x += (mouse.x - virtual.x) * FX.chase;
    virtual.y += (mouse.y - virtual.y) * FX.chase;
    virtual.vx = virtual.x - prevX;
    virtual.vy = virtual.y - prevY;
    // Filtered, so a shaky hand does not make it shiver.
    virtual.smoothVx += (virtual.vx - virtual.smoothVx) * FX.velocityFilter;
    const target = Math.max(
      -FX.maxTurnDegrees,
      Math.min(FX.maxTurnDegrees, virtual.smoothVx * FX.turnPerPixel),
    );
    virtual.angle += (target - virtual.angle) * FX.turnEase;

    cursor.style.transform = `translate3d(${virtual.x}px, ${virtual.y}px, 0)`;
    rotator.style.transform = `rotate(${virtual.angle}deg)`;

    const speed = Math.hypot(virtual.vx, virtual.vy);
    if (seen && speed > FX.trailMinSpeed) {
      burst(Math.min(Math.floor(speed * FX.trailPerSpeed) + 1, FX.trailMaxPerFrame), false);
    }

    ctx.clearRect(0, 0, width, height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vx *= FX.airResistance;
      p.vy *= FX.airResistance;
      p.vy += FX.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      p.size *= FX.shrink;
      draw(ctx, p);
      if (p.life <= 0 || p.size <= FX.minSize) particles.splice(i, 1);
    }
    frame = requestAnimationFrame(animate);
  };

  window.addEventListener("resize", onResize);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mousedown", onDown);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("mouseover", onOver);
  frame = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mousedown", onDown);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("mouseover", onOver);
    cursor.classList.remove(CLASS_LIVE, CLASS_CLICKING, CLASS_HOVERING);
  };
}
