import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runActions, type ExecutorContext } from "./executor.ts";
import { fakeCdp } from "./fake-cdp.ts";
import {
  LAYOUT_TOLERANCE_PX,
  SURVEY_MAX_SCREENS,
  scrollForAction,
  surveyPositions,
} from "./survey.ts";

import type { Overlay } from "./overlay.ts";
import type { AgentAction } from "@acorn/shared/agent-contract";

describe("surveyPositions", () => {
  it("is empty for a page about one screen tall", () => {
    assert.deepEqual(surveyPositions(700, 600), []);
    assert.deepEqual(surveyPositions(600, 600), []);
  });

  it("goes from the top to the very bottom, each screen repeating a little of the one before", () => {
    const positions = surveyPositions(2000, 600);
    assert.equal(positions[0], 0);
    assert.equal(positions.at(-1), 1400);
    for (let i = 1; i < positions.length; i += 1) {
      const gap = positions[i] - positions[i - 1];
      assert.ok(gap > 0 && gap <= 600 * 0.85 + 1, `gap ${gap}`);
    }
  });

  it("stops at the most screens a survey takes, from the top", () => {
    const positions = surveyPositions(20_000, 600);
    assert.equal(positions.length, SURVEY_MAX_SCREENS);
    assert.equal(positions[0], 0);
  });
});

/** A page of this height that scrolls to where it is told, up to its end, with a sticky start. */
function page(height: number, options: { stuckAt?: number } = {}) {
  let y = 0;
  const cdp = fakeCdp({
    "Runtime.evaluate": (params: { expression?: string }) => {
      const to = /top: (-?[\d.]+)/.exec(params.expression ?? "");
      if (to) y = options.stuckAt ?? Math.max(0, Math.min(Number(to[1]), height - 600));
      return {};
    },
    "Page.getLayoutMetrics": () => ({
      cssVisualViewport: { pageY: y },
      cssContentSize: { height },
    }),
  });
  return { cdp, y: () => y };
}

const instant = async () => {};
const onScreen = (scrollTo: number, pageHeight: number): AgentAction => ({
  id: "a",
  kind: "click",
  x: 10,
  y: 10,
  scrollTo,
  pageHeight,
});

describe("scrollForAction", () => {
  it("does nothing for an action with no screen", async () => {
    const { cdp } = page(2000);
    await scrollForAction(cdp, { id: "a", kind: "click", x: 1, y: 1 }, 1, instant);
    assert.equal(cdp.of("Runtime.evaluate").length, 0);
  });

  it("scrolls to the screen the point was measured on, converting screenshot pixels to page pixels", async () => {
    const { cdp, y } = page(4000);
    await scrollForAction(cdp, onScreen(500, 2000), 0.5, instant); // 500 screenshot px = 1000 page px
    assert.equal(y(), 1000);
  });

  it("refuses when the page has grown or shrunk since the survey, so no point below it is trusted", async () => {
    const { cdp } = page(2000 + LAYOUT_TOLERANCE_PX + 20);
    await assert.rejects(
      scrollForAction(cdp, onScreen(600, 2000), 1, instant),
      /changed shape since the survey/,
    );
  });

  it("allows a page that moved a few pixels", async () => {
    const { cdp } = page(2000 + LAYOUT_TOLERANCE_PX - 2);
    await scrollForAction(cdp, onScreen(600, 2000), 1, instant);
  });

  it("refuses when the page will not scroll where it was asked to", async () => {
    const { cdp } = page(2000, { stuckAt: 100 });
    await assert.rejects(
      scrollForAction(cdp, onScreen(600, 2000), 1, instant),
      /would not scroll to where the survey saw this/,
    );
  });
});

describe("the executor and a survey screen", () => {
  function context(height: number) {
    const target = page(height);
    const ctx: ExecutorContext = {
      cdp: target.cdp,
      overlay: {
        moveTo: async () => {},
        click: async () => {},
        hover: async () => {},
      } as unknown as Overlay,
      scale: () => 1,
      resume: async () => ({ fileName: "r.pdf", contentType: "application/pdf", base64: "QQ==" }),
      sleep: instant,
      checkStopped: () => {},
    };
    return { ctx, ...target };
  }

  it("scrolls to the screen, then clicks the point on it", async () => {
    const { ctx, cdp, y } = context(2000);
    const results = await runActions(ctx, [onScreen(700, 2000)]);
    assert.equal(results[0].ok, true);
    assert.equal(y(), 700);
    const methods = cdp.sent.map((c) => c.method);
    assert.ok(methods.indexOf("Input.dispatchMouseEvent") > methods.indexOf("Runtime.evaluate"));
  });

  it("does not click, and skips the rest, when the page changed shape", async () => {
    const { ctx, cdp } = context(2400);
    const results = await runActions(ctx, [
      onScreen(700, 2000),
      { id: "b", kind: "click", x: 5, y: 5 },
    ]);
    assert.equal(results[0].ok, false);
    assert.match(results[0].error ?? "", /changed shape/);
    assert.equal(results[1].ok, false);
    assert.equal(cdp.of("Input.dispatchMouseEvent").length, 0);
  });
});
