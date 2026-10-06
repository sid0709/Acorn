/**
 * Placeholders are drawn faded by convention: text whose contrast against the page
 * is well below the control's own text colour is an empty-state hint, not a value.
 */

/** A part is placeholder ink when its contrast is under this share of the control's. */
const PLACEHOLDER_CONTRAST_SHARE = 0.5;
/** Ancestors searched for an opaque background before assuming the page default. */
const BACKGROUND_MAX_DEPTH = 24;

type Rgba = { r: number; g: number; b: number; a: number };

const PAGE_DEFAULT_BACKGROUND: Rgba = { r: 255, g: 255, b: 255, a: 1 };

function parseColor(value: string): Rgba | null {
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;
  const [r, g, b, a = "1"] = match[1].split(/[\s,/]+/).filter(Boolean);
  const rgba = { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
  return Object.values(rgba).every(Number.isFinite) ? rgba : null;
}

function backgroundBehind(el: Element): Rgba {
  let node: Element | null = el;
  for (let depth = 0; node && depth < BACKGROUND_MAX_DEPTH; depth += 1) {
    const color = parseColor(
      node.ownerDocument.defaultView?.getComputedStyle(node).backgroundColor || "",
    );
    if (color && color.a > 0) return { ...color, a: 1 };
    node = node.parentElement;
  }
  return PAGE_DEFAULT_BACKGROUND;
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastOn(el: Element, background: Rgba): number | null {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  const ink = parseColor(style?.color || "");
  if (!ink) return null;
  const alpha = ink.a * Number(style?.opacity ?? 1);
  const blend = (fg: number, bg: number) => fg * alpha + bg * (1 - alpha);
  const shown = {
    r: blend(ink.r, background.r),
    g: blend(ink.g, background.g),
    b: blend(ink.b, background.b),
    a: 1,
  };
  const [hi, lo] = [luminance(shown), luminance(background)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** True when `host` text is drawn faded relative to how `control` draws its own text. */
export function looksLikePlaceholderInk(host: Element, control: Element): boolean {
  const background = backgroundBehind(host);
  const text = contrastOn(host, background);
  const reference = contrastOn(control, background);
  if (text == null || reference == null) return false;
  return text < reference * PLACEHOLDER_CONTRAST_SHARE;
}
