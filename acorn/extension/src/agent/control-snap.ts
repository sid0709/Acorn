/**
 * Aims a click onto the small control beside its point, inside frames of any origin too. The model
 * measures a point on a picture; on a control a dozen pixels wide, a point a few pixels off lands on the
 * wrapper round it (a span the page colours yellow for "required"), and the click does nothing: a
 * recorded iCIMS run clicked a Signature box twelve times, each 1 to 8 px left of the input, inside a
 * frame of another origin where no mark could bind the point. Before a click, the document under the
 * point is asked what is there; when it is no control itself and a small control lies within
 * `SNAP_RADIUS_PX`, the click goes to that control's centre. A point already on a control, or with no
 * control near, is left as it is. The page says only where things are, never what they hold.
 *
 * A frame of another origin cannot be read from its parent, so each document is asked through
 * `chrome.scripting` by its frame id, and the point is carried down through the frames at the point.
 */

/** How far (CSS pixels) a point may lie from a small control and still be meant for it. */
export const SNAP_RADIUS_PX = 12;
/** The largest control (CSS pixels, either side) a point is snapped onto: a big one needs no help. */
export const SNAP_MAX_CONTROL_PX = 48;
/** How many frames deep the point is followed. */
const SNAP_MAX_FRAMES = 4;

/** What a document says of the point: a frame to follow, a control to snap onto, or nothing to do. */
export type PointAnswer =
  | { kind: "frame"; name: string; src: string; x: number; y: number; w: number; h: number }
  | { kind: "snap"; x: number; y: number; tag: string; type: string; id: string }
  | { kind: "none"; tag: string };

/** The point a click goes to instead, with a line for the log. */
export interface SnappedPoint {
  x: number;
  y: number;
  detail: string;
}

/**
 * Runs in a document: what is at the point (CSS pixels of that document's window). Serialised by
 * `chrome.scripting`, so it uses nothing from outside its own body.
 */
function readPoint(px: number, py: number, radius: number, maxSize: number): PointAnswer {
  const INTERACTIVE =
    "input,select,textarea,button,a[href],label,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=option],[role=menuitem],[role=tab],[contenteditable='true'],[tabindex]:not([tabindex='-1'])";
  let el: Element | null = document.elementFromPoint(px, py);
  for (let depth = 0; el && el.shadowRoot && depth < 8; depth += 1) {
    const inner = el.shadowRoot.elementFromPoint(px, py);
    if (!inner || inner === el) break;
    el = inner;
  }
  if (!el) return { kind: "none", tag: "" };
  const tag = el.tagName.toLowerCase();
  if (tag === "iframe" || tag === "frame") {
    const r = el.getBoundingClientRect();
    return {
      kind: "frame",
      name: el.getAttribute("name") ?? "",
      src: (el as HTMLIFrameElement).src || el.getAttribute("src") || "",
      x: r.left + el.clientLeft,
      y: r.top + el.clientTop,
      w: r.width,
      h: r.height,
    };
  }
  if (el.closest(INTERACTIVE)) return { kind: "none", tag };
  const near: { d: number; r: DOMRect; c: Element }[] = [];
  for (let node: Element | null = el, up = 0; node && up < 3; node = node.parentElement, up += 1) {
    for (const c of node.querySelectorAll(INTERACTIVE)) {
      const r = c.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.width > maxSize || r.height > maxSize) continue;
      const dx = Math.max(r.left - px, 0, px - r.right);
      const dy = Math.max(r.top - py, 0, py - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d <= radius) near.push({ d, r, c });
    }
    if (near.length > 0) break;
  }
  near.sort((a, b) => a.d - b.d);
  const best = near[0];
  if (!best) return { kind: "none", tag };
  return {
    kind: "snap",
    x: best.r.left + best.r.width / 2,
    y: best.r.top + best.r.height / 2,
    tag: best.c.tagName.toLowerCase(),
    type: (best.c.getAttribute("type") ?? "").toLowerCase(),
    id: best.c.id,
  };
}

type FrameInfo = { frameId: number; parentFrameId: number; url: string };

/** Asks one document of the tab what is at a point of its window; null when it cannot be asked. */
async function askFrame(
  tabId: number,
  frameId: number,
  x: number,
  y: number,
): Promise<PointAnswer | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: readPoint,
      args: [x, y, SNAP_RADIUS_PX, SNAP_MAX_CONTROL_PX],
    });
    const answer = first?.result;
    return answer && typeof answer === "object" && "kind" in answer ? answer : null;
  } catch {
    return null;
  }
}

/** The address without its fragment, for matching a frame to the element that holds it. */
function plain(url: string): string {
  return url.split("#")[0] ?? url;
}

/**
 * Which frame of the tab the iframe element at the point holds: the one child of the frame asked, else
 * the child at the element's address, else the one named as the element names it (asked for its name).
 */
export async function pickChildFrame(
  frames: readonly FrameInfo[],
  parentFrameId: number,
  element: { name: string; src: string },
  nameOf: (frameId: number) => Promise<string>,
): Promise<number | null> {
  const children = frames.filter((frame) => frame.parentFrameId === parentFrameId);
  const only = children.length === 1 ? children[0] : undefined;
  if (children.length === 0) return null;
  if (only) return only.frameId;
  const src = plain(element.src);
  const bySrc = src ? children.find((frame) => plain(frame.url) === src) : undefined;
  if (bySrc) return bySrc.frameId;
  if (element.name) {
    const names = await Promise.all(children.map((frame) => nameOf(frame.frameId)));
    const at = names.indexOf(element.name);
    const named = at >= 0 ? children[at] : undefined;
    if (named) return named.frameId;
  }
  return null;
}

async function frameName(tabId: number, frameId: number): Promise<string> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: () => window.name,
    });
    return typeof first?.result === "string" ? first.result : "";
  } catch {
    return "";
  }
}

/**
 * The point a click at (x, y) (CSS pixels of the tab's window) should go to instead, when it lies beside a
 * small control rather than on one; null when it is already on a control, nothing is near, or the page
 * cannot be asked. The point is followed down through frames of any origin.
 */
export async function snapToControl(
  tabId: number,
  x: number,
  y: number,
): Promise<SnappedPoint | null> {
  let frameId = 0;
  let offX = 0;
  let offY = 0;
  let lx = x;
  let ly = y;
  let frames: FrameInfo[] | null = null;
  for (let depth = 0; depth <= SNAP_MAX_FRAMES; depth += 1) {
    const answer = await askFrame(tabId, frameId, lx, ly);
    if (!answer) return null;
    if (answer.kind === "snap") {
      const dx = answer.x - lx;
      const dy = answer.y - ly;
      if (Math.hypot(dx, dy) < 0.5) return null;
      const what =
        [answer.tag, answer.type].filter(Boolean).join(":") + (answer.id ? `#${answer.id}` : "");
      return {
        x: offX + answer.x,
        y: offY + answer.y,
        detail: `aimed ${Math.round(Math.hypot(dx, dy))} px onto the ${what} beside the point`,
      };
    }
    if (answer.kind !== "frame") return null;
    if (!frames) {
      frames = ((await chrome.webNavigation.getAllFrames({ tabId })) ?? []).map((frame) => ({
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId,
        url: frame.url,
      }));
    }
    const child = await pickChildFrame(frames, frameId, answer, (id) => frameName(tabId, id));
    if (child == null) return null;
    offX += answer.x;
    offY += answer.y;
    lx -= answer.x;
    ly -= answer.y;
    frameId = child;
  }
  return null;
}
