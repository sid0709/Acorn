/**
 * A page for tests: a small tree of elements with places on it, a window that scrolls, and a debugger
 * session (`Cdp`) that runs the scripts the run puts in a page against it. It stands in for the parts of a
 * browser the scripts use, so what they do can be tested without one. It is not shipped.
 */

import type { Cdp } from "../../src/agent/cdp.ts";

/** The page's box of an element, in the page's CSS pixels from its top left. */
export type PageBox = { x: number; y: number; w: number; h: number };

type Style = { display: string; visibility: string; position: string };

const CONTROL_TAGS = new Set(["input", "textarea", "select", "button"]);
const CONTROL_ROLES = new Set(["button", "checkbox", "radio", "combobox"]);

export class FakeElement {
  readonly nodeType = 1;
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  style: Style = { display: "block", visibility: "visible", position: "static" };
  textContent = "";
  labels: FakeElement[] | null = null;
  isContentEditable = false;
  connected = true;

  constructor(
    readonly page: FakePage,
    private readonly tag: string,
    public box: PageBox,
  ) {}

  /** As a browser gives it for an HTML element: in capitals. */
  get tagName(): string {
    return this.tag.toUpperCase();
  }

  get id(): string {
    return this.attributes.id ?? "";
  }

  get isConnected(): boolean {
    return this.connected;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  contains(other: FakeElement | null): boolean {
    for (let node = other; node; node = node.parentElement) if (node === this) return true;
    return false;
  }

  getBoundingClientRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } {
    const left = this.box.x - this.page.scrollX;
    const top = this.box.y - this.page.scrollY;
    return {
      left,
      top,
      right: left + this.box.w,
      bottom: top + this.box.h,
      width: this.box.w,
      height: this.box.h,
    };
  }

  getRootNode(): unknown {
    return this.page.document;
  }

  /** The controls inside this element (the scripts only ever ask for their selector of controls). */
  querySelectorAll(): FakeElement[] {
    return this.page.controls().filter((el) => el !== this && this.contains(el));
  }

  /** Whether the page's own selector of controls matches this element. */
  isControl(): boolean {
    const tag = this.tag.toLowerCase();
    const role = this.attributes.role;
    return (
      CONTROL_TAGS.has(tag) ||
      (tag === "a" && "href" in this.attributes) ||
      (role !== undefined && CONTROL_ROLES.has(role)) ||
      this.attributes.contenteditable === "true"
    );
  }

  add(tag: string, box: PageBox, attributes: Record<string, string> = {}): FakeElement {
    const child = new FakeElement(this.page, tag, box);
    child.attributes = attributes;
    child.parentElement = this;
    this.children.push(child);
    this.page.all.push(child);
    return child;
  }

  remove(): void {
    for (const el of this.page.all) if (this.contains(el)) el.connected = false;
  }
}

class FakeObserver {
  constructor(
    private readonly page: FakePage,
    readonly callback: () => void,
  ) {
    page.observers.push(this);
  }
  observe(): void {}
  disconnect(): void {
    this.page.observers = this.page.observers.filter((one) => one !== this);
  }
}

/** A running animation, as `document.getAnimations()` lists it. */
export type FakeAnimation = {
  playState: string;
  effect: { target: { getRootNode: () => unknown }; getComputedTiming: () => { endTime: number } };
};

export class FakePage {
  scrollX = 0;
  scrollY = 0;
  pageHeight = 3000;
  viewHeight = 800;
  visibilityState = "visible";
  observers: FakeObserver[] = [];
  animations: FakeAnimation[] = [];
  /** What `elementFromPoint` finds. */
  hitAt: (x: number, y: number) => FakeElement | null = () => null;
  readonly all: FakeElement[] = [];
  readonly html: FakeElement;
  readonly body: FakeElement;
  /** The properties scripts put on the window, and the scroll it has. */
  readonly window: Record<string, unknown>;
  readonly document: Record<string, unknown>;

  /** The observer classes a script is given, bound to this page. */
  private readonly observerClass: new (callback: () => void) => FakeObserver;

  constructor() {
    this.html = new FakeElement(this, "html", { x: 0, y: 0, w: 1280, h: 3000 });
    this.body = this.html.add("body", { x: 0, y: 0, w: 1280, h: 3000 });
    this.all.push(this.html);
    const owner = (): FakePage => this;
    this.observerClass = class extends FakeObserver {
      constructor(callback: () => void) {
        super(owner(), callback);
      }
    };
    this.window = {
      ResizeObserver: this.observerClass,
      scrollTo: (options: { top: number }) => {
        this.scrollY = Math.max(0, Math.min(options.top, this.pageHeight - this.viewHeight));
      },
    };
    Object.defineProperty(this.window, "scrollX", { get: () => this.scrollX });
    Object.defineProperty(this.window, "scrollY", { get: () => this.scrollY });
    this.document = {
      documentElement: this.html,
      body: this.body,
      querySelectorAll: () => this.controls(),
      getElementById: (id: string) => this.all.find((el) => el.id === id) ?? null,
      elementFromPoint: (x: number, y: number) => this.hitAt(x, y),
      getAnimations: () => this.animations,
    };
    Object.defineProperty(this.document, "visibilityState", { get: () => this.visibilityState });
  }

  /** Controls that are in the page, in the order they were added. */
  controls(): FakeElement[] {
    return this.all.filter((el) => el.connected && el.isControl());
  }

  /** Something in the page changed: its observers are told. */
  mutated(): void {
    for (const observer of [...this.observers]) observer.callback();
  }

  /** Runs an expression in the page as the debugger would, and gives its value as the debugger would. */
  async evaluate(expression: string, awaitPromise = false): Promise<unknown> {
    // The fake page exists to run the scripts the run puts in a page, which are text.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function(
      "window",
      "document",
      "getComputedStyle",
      "MutationObserver",
      "ResizeObserver",
      "performance",
      "requestAnimationFrame",
      "setTimeout",
      "WeakRef",
      `return ${expression}`,
    );
    const value: unknown = (run as (...globals: unknown[]) => unknown)(
      this.window,
      this.document,
      (el: FakeElement) => el.style,
      this.observerClass,
      this.observerClass,
      performance,
      (callback: () => void) => setTimeout(callback, 0),
      setTimeout,
      WeakRef,
    );
    const done = awaitPromise ? await value : value;
    return done === undefined ? undefined : JSON.parse(JSON.stringify(done));
  }

  /** A debugger session on this page. */
  cdp(): Cdp & { sent: { method: string; params?: object }[] } {
    const sent: { method: string; params?: object }[] = [];
    const send = async <T>(method: string, params?: object): Promise<T> => {
      sent.push({ method, params });
      if (method === "Runtime.evaluate") {
        const { expression, awaitPromise } = params as {
          expression: string;
          awaitPromise?: boolean;
        };
        return { result: { value: await this.evaluate(expression, awaitPromise) } } as T;
      }
      if (method === "Page.getLayoutMetrics") {
        return {
          cssVisualViewport: { pageY: this.scrollY, clientHeight: this.viewHeight },
          cssContentSize: { height: this.pageHeight },
        } as T;
      }
      if (method === "Input.dispatchMouseEvent") {
        const event = params as { type: string; deltaY?: number };
        if (event.type === "mouseWheel") {
          this.scrollY = Math.max(
            0,
            Math.min(this.scrollY + (event.deltaY ?? 0), this.pageHeight - this.viewHeight),
          );
        }
      }
      return {} as T;
    };
    return {
      sent,
      send,
      onEvent: () => () => undefined,
      onDetach: () => () => undefined,
      detach: () => Promise.resolve(),
    };
  }
}
