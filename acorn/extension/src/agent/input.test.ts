import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeCdp } from "./fake-cdp.ts";
import {
  KEYSTROKE_TEXT_MAX_CHARS,
  WHEEL_STEP_PX,
  clickAt,
  pressKeys,
  typeText,
  wheelAt,
} from "./input.ts";

const mouse = (cdp: ReturnType<typeof fakeCdp>) =>
  cdp.of("Input.dispatchMouseEvent").map((command) => command.params?.type);

describe("clickAt", () => {
  it("moves, presses, and releases", async () => {
    const cdp = fakeCdp();
    await clickAt(cdp, 40, 50);
    assert.deepEqual(mouse(cdp), ["mouseMoved", "mousePressed", "mouseReleased"]);
    assert.equal(cdp.of("Input.dispatchMouseEvent")[1].params?.clickCount, 1);
  });

  it("counts a double and a triple click", async () => {
    const cdp = fakeCdp();
    await clickAt(cdp, 1, 2, { count: 2 });
    assert.deepEqual(
      cdp
        .of("Input.dispatchMouseEvent")
        .map((c) => `${c.params?.type}:${c.params?.clickCount ?? "-"}`),
      ["mouseMoved:-", "mousePressed:1", "mouseReleased:1", "mousePressed:2", "mouseReleased:2"],
    );
  });

  it("uses the right button when asked", async () => {
    const cdp = fakeCdp();
    await clickAt(cdp, 1, 2, { button: "right" });
    assert.equal(cdp.of("Input.dispatchMouseEvent")[1].params?.button, "right");
  });
});

describe("wheelAt", () => {
  it("scrolls a short distance in one event", async () => {
    const cdp = fakeCdp();
    await wheelAt(cdp, 10, 10, 0, 300);
    assert.equal(cdp.of("Input.dispatchMouseEvent").length, 1);
    assert.equal(cdp.sent[0].params?.deltaY, 300);
  });

  it("splits a long scroll into steps that add up", async () => {
    const cdp = fakeCdp();
    await wheelAt(cdp, 10, 10, 0, WHEEL_STEP_PX * 3 + 1);
    const events = cdp.of("Input.dispatchMouseEvent");
    assert.equal(events.length, 4);
    const total = events.reduce((sum, event) => sum + Number(event.params?.deltaY), 0);
    assert.ok(Math.abs(total - (WHEEL_STEP_PX * 3 + 1)) < 1e-6);
  });
});

describe("pressKeys", () => {
  it("sends every event of the chord", async () => {
    const cdp = fakeCdp();
    await pressKeys(cdp, "Control+a");
    assert.deepEqual(
      cdp.of("Input.dispatchKeyEvent").map((c) => c.params?.type),
      ["rawKeyDown", "rawKeyDown", "keyUp", "keyUp"],
    );
  });
});

describe("typeText", () => {
  it("types short text one key at a time, as a person does", async () => {
    const cdp = fakeCdp();
    await typeText(cdp, "Ab 1");
    const keys = cdp.of("Input.dispatchKeyEvent");
    assert.deepEqual(
      keys.filter((c) => c.params?.type === "keyDown").map((c) => c.params?.text),
      ["A", "b", " ", "1"],
    );
    assert.equal(keys.filter((c) => c.params?.type === "keyUp").length, 4);
    assert.equal(cdp.of("Input.insertText").length, 0);
  });

  it("inserts characters that have no key of their own, in place", async () => {
    const cdp = fakeCdp();
    await typeText(cdp, "aé\nb");
    assert.deepEqual(
      cdp.sent.map((c) =>
        c.method === "Input.insertText"
          ? `insert:${JSON.stringify(c.params?.text)}`
          : `${c.params?.type}:${c.params?.text ?? ""}`,
      ),
      ["keyDown:a", "keyUp:", 'insert:"é\\n"', "keyDown:b", "keyUp:"],
    );
  });

  it("inserts long text whole", async () => {
    const cdp = fakeCdp();
    const long = "x".repeat(KEYSTROKE_TEXT_MAX_CHARS + 1);
    await typeText(cdp, long);
    assert.equal(cdp.of("Input.dispatchKeyEvent").length, 0);
    assert.deepEqual(
      cdp.of("Input.insertText").map((c) => c.params?.text),
      [long],
    );
  });
});
