import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OVERLAY_SCRIPT, OVERLAY_STOP_BINDING } from "./overlay.ts";
import { FOCUS_SCRIPT } from "./page-info.ts";

type El = Record<string, unknown>;

/** Runs a page-side script against a stand-in document. */
function runInPage<T>(script: string, document: unknown, window: Record<string, unknown> = {}): T {
  return new Function("document", "window", `return ${script};`)(document, window) as T;
}

function field(extra: El): El {
  return {
    tagName: "INPUT",
    getAttribute: (name: string) =>
      (extra.attrs as Record<string, string> | undefined)?.[name] ?? null,
    ownerDocument: { getElementById: () => null },
    labels: [],
    validity: { valid: true },
    ...extra,
  };
}

describe("FOCUS_SCRIPT", () => {
  it("reports nothing when no control has focus", () => {
    const body = {};
    assert.equal(runInPage(FOCUS_SCRIPT, { activeElement: body, body, documentElement: {} }), null);
  });

  it("reads a text field's label and value", () => {
    const el = field({
      value: "  Ada   Lovelace ",
      attrs: { type: "text", name: "full_name" },
      labels: [{ textContent: "Full name" }],
      required: true,
    });
    const out = runInPage<Record<string, unknown>>(FOCUS_SCRIPT, {
      activeElement: el,
      body: {},
      documentElement: {},
    });
    assert.deepEqual(out, {
      tag: "input",
      label: "Full name",
      type: "text",
      value: "Ada Lovelace",
      required: true,
    });
  });

  it("never reports what a password field holds", () => {
    const el = field({ value: "hunter2", attrs: { type: "password" } });
    const out = runInPage<{ value: string }>(FOCUS_SCRIPT, {
      activeElement: el,
      body: {},
      documentElement: {},
    });
    assert.equal(out.value, "(7 characters, hidden)");
    assert.ok(!JSON.stringify(out).includes("hunter2"));
  });

  it("lists a native list's options, which a screenshot cannot show", () => {
    const options = [{ text: "Yes" }, { text: "No" }, { text: "Prefer not to say" }];
    const el = field({
      tagName: "SELECT",
      options,
      selectedOptions: [options[1]],
      multiple: false,
      attrs: { "aria-label": "Authorized to work?" },
    });
    const out = runInPage<Record<string, unknown>>(FOCUS_SCRIPT, {
      activeElement: el,
      body: {},
      documentElement: {},
    });
    assert.deepEqual(out.options, ["Yes", "No", "Prefer not to say"]);
    assert.equal(out.value, "No");
    assert.equal(out.label, "Authorized to work?");
  });

  it("says what the page flags as wrong", () => {
    const el = field({
      value: "x",
      validity: { valid: false },
      validationMessage: "Enter a valid email",
    });
    const out = runInPage<{ invalid: string }>(FOCUS_SCRIPT, {
      activeElement: el,
      body: {},
      documentElement: {},
    });
    assert.equal(out.invalid, "Enter a valid email");
  });

  it("reads a checkbox's state", () => {
    const el = field({ attrs: { type: "checkbox" }, checked: true });
    const out = runInPage<{ checked: boolean }>(FOCUS_SCRIPT, {
      activeElement: el,
      body: {},
      documentElement: {},
    });
    assert.equal(out.checked, true);
  });
});

/** A node that records what is done to it. */
function node(tag: string): El {
  const classes = new Set<string>();
  const self: El = {
    tag,
    className: "",
    style: {},
    children: [] as unknown[],
    isConnected: false,
    textContent: "",
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
      has: (c: string) => classes.has(c),
    },
    offsetWidth: 0,
    append(...kids: unknown[]) {
      (self.children as unknown[]).push(...kids);
    },
    appendChild(kid: unknown) {
      (self.children as unknown[]).push(kid);
      (kid as El).isConnected = true;
      return kid;
    },
    setAttribute() {},
    listeners: {} as Record<string, (event: unknown) => void>,
    addEventListener(type: string, listener: (event: unknown) => void) {
      (self.listeners as Record<string, unknown>)[type] = listener;
    },
    attachShadow() {
      self.shadow = node("shadow");
      return self.shadow;
    },
    remove() {
      self.isConnected = false;
    },
  };
  return self;
}

describe("OVERLAY_SCRIPT", () => {
  const environment = () => {
    const root = node("html");
    const document = {
      documentElement: root,
      createElement: (tag: string) => node(tag),
      createElementNS: (_ns: string, tag: string) => node(tag),
    };
    class Sheet {
      css = "";
      replaceSync(css: string) {
        this.css = css;
      }
    }
    const window: Record<string, unknown> = {};
    const defineProperty = (_target: unknown, name: string, descriptor: { value: unknown }) => {
      window[name] = descriptor.value;
    };
    const run = () =>
      new Function("document", "window", "CSSStyleSheet", "Object", `return ${OVERLAY_SCRIPT};`)(
        document,
        window,
        Sheet,
        {
          defineProperty,
        },
      );
    return { root, window, run };
  };

  it("draws the overlay once and reconnects it on the next call", () => {
    const { root, window, run } = environment();
    assert.equal(run(), true);
    const controller = window.__acornAgentOverlay as { remove(): void; attach(): void };
    assert.ok(controller);
    assert.equal((root.children as unknown[]).length, 1);
    run();
    assert.equal((root.children as unknown[]).length, 1);
    controller.remove();
    controller.attach();
    assert.equal((root.children as unknown[]).length, 2);
  });

  it("calls the Stop binding when the button is pressed", () => {
    const { root, window, run } = environment();
    const calls: string[] = [];
    window[OVERLAY_STOP_BINDING] = (what: string) => calls.push(what);
    run();
    const find = (from: El, tag: string): El | null => {
      if (from.tag === tag) return from;
      for (const child of [
        ...((from.children as El[] | undefined) ?? []),
        from.shadow as El | undefined,
      ]) {
        if (!child) continue;
        const found = find(child, tag);
        if (found) return found;
      }
      return null;
    };
    const stop = find(root, "button");
    assert.ok(stop, "the overlay has a Stop button");
    (stop.listeners as Record<string, (event: unknown) => void>).click({ stopPropagation() {} });
    assert.deepEqual(calls, ["stop"]);
  });

  it("uses no innerHTML, which a page may forbid", () => {
    assert.doesNotMatch(OVERLAY_SCRIPT, /innerHTML/);
  });

  it("draws the demo's Acorn cursor: its outline, swoosh and gradient stops", () => {
    for (const part of [
      "M 50 14 C 62 14, 76 36, 83 62 C 89 82, 79 88, 66 84 C 56 80, 53 66, 50 66 C 47 66, 44 80, 34 84 C 21 88, 11 82, 17 62 C 24 36, 38 14, 50 14 Z",
      "M 39 63 C 44 51, 56 51, 61 63",
      '"stop-color": "#ffe37a"',
      '"stop-color": "#ff4800"',
      "drop-shadow(0 0 16px rgba(255, 170, 0, 0.95))",
      "animation: pulseAura 2.2s infinite alternate ease-in-out",
      "virtual.x += (mouse.x - virtual.x) * 0.2",
      "spawnParticles(virtual.x, virtual.y, 45, true)",
    ]) {
      assert.ok(
        OVERLAY_SCRIPT.includes(part) || OVERLAY_SCRIPT.includes(JSON.stringify(part).slice(1, -1)),
        part,
      );
    }
  });

  it("resolves a move even when the page draws no frames", async () => {
    const { window, run } = environment();
    run();
    const controller = window.__acornAgentOverlay as {
      moveTo(x: number, y: number): Promise<void>;
    };
    const started = Date.now();
    await controller.moveTo(100, 100);
    assert.ok(Date.now() - started < 2000);
  });
});
