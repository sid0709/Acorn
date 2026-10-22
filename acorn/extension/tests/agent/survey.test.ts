import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ControlWatch } from "../../src/agent/control-watch.ts";
import {
  SURVEY_OVERLAP_PX,
  SurveyKeeper,
  actedOn,
  scrollForAction,
  settledStill,
  focusPositions,
  SURVEY_FOCUS_EDGE_PX,
  surveyPositions,
  type PlaceDeps,
} from "../../src/agent/survey.ts";

import { FakeElement, FakePage } from "./fake-page.ts";

import type { Shot } from "../../src/agent/capture.ts";
import type { AgentAction } from "@acorn/shared/agent-contract";

/** The text box the point was aimed at, planned at page y 3880. */
const PLANNED = { id: "input:text:q:", x: 400, y: 3880, w: 300, h: 40 };

type Case = {
  page: FakePage;
  field: FakeElement;
  deps: PlaceDeps;
  slept: number[];
  located: string[];
  held: [number, number][];
  /** What `shift` answers for a point bound to no control; unset means the page was not asked. */
  shift?: number | null;
};

/** A page 6076 px tall, scrolled to `scrollY`, whose text box is at page y `fieldY`. */
function setup(options: { fieldY: number; scrollY: number; pageHeight?: number }): Case {
  const page = new FakePage();
  page.pageHeight = options.pageHeight ?? 6076;
  page.scrollY = options.scrollY;
  const field = page.body.add(
    "input",
    { x: 400, y: options.fieldY, w: 300, h: 40 },
    { type: "text", name: "q" },
  );
  page.hitAt = (x, y) => {
    const px = x + page.scrollX;
    const py = y + page.scrollY;
    const box = field.box;
    return px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h ? field : null;
  };
  const cdp = page.cdp();
  const watch = new ControlWatch();
  const slept: number[] = [];
  const located: string[] = [];
  const held: [number, number][] = [];
  const c: Partial<Case> = {};
  const deps: PlaceDeps = {
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    locate: (action) => {
      located.push(action.id);
      return Promise.resolve({ x: 111, y: 222 });
    },
    marks: {
      move: (action, scale) =>
        action.mark ? watch.move(cdp, action.mark, scale) : Promise.resolve(null),
      holds: (action, x, y) => {
        held.push([x, y]);
        return action.mark ? watch.holds(cdp, action.mark, x, y) : Promise.resolve(false);
      },
      shift: () => c.shift ?? null,
    },
  };
  return Object.assign(c, { page, field, deps, slept, located, held });
}

/** A click on the text box as the plan aimed at it: 100 px down the screen scrolled to page y 3800, on a page then 6000 tall. */
function click(over: Partial<AgentAction> = {}): AgentAction {
  return {
    id: "s2a5",
    kind: "click",
    x: 500,
    y: 100,
    scrollTo: 3800,
    pageHeight: 6000,
    zone: 1,
    mark: PLANNED,
    ...over,
  };
}

describe("placing a point on a page that changed shape", () => {
  it("does not scroll when the window already shows the point clear of its edges", async () => {
    // The box moved 76 px down; the window, at 3700, shows it 276 px from its top.
    const c = setup({ fieldY: 3956, scrollY: 3700 });
    const where = await scrollForAction(c.page.cdp(), click(), 1, c.deps);
    assert.deepEqual(where, { x: 500, y: 276 });
    assert.equal(c.page.scrollY, 3700, "the page did not move");
    assert.deepEqual(c.slept, [], "nothing was scrolled, so nothing was waited for");
  });

  it("goes straight to where the form moved a point bound to no control, in one scroll", async () => {
    const c = setup({ fieldY: 3956, scrollY: 5000 });
    c.shift = 76;
    const where = await scrollForAction(c.page.cdp(), click({ mark: undefined }), 1, c.deps);
    assert.equal(
      c.page.scrollY,
      3876,
      "to the survey's place moved by the form's growth, not via 3800",
    );
    assert.deepEqual(where, { x: 500, y: 100 });
  });

  it("moves the point with the control it was bound to, without looking for a picture of it", async () => {
    // A message appeared above the box: it is 76 px lower and the page 76 px taller.
    const c = setup({ fieldY: 3956, scrollY: 5000 });
    const where = await scrollForAction(c.page.cdp(), click(), 1, c.deps);
    assert.deepEqual(
      where,
      { x: 500, y: 100 },
      "the point keeps its place in the window; the window moved with the control",
    );
    assert.equal(c.page.scrollY, 3876);
    assert.deepEqual(c.located, [], "no screenshot was asked about");
    assert.deepEqual(
      c.held,
      [[500, 100]],
      "the page was asked whether the point is on the control's field",
    );
  });

  it("leaves the point where it was when the control did not move, though the page is taller", async () => {
    const c = setup({ fieldY: 3880, scrollY: 3800 });
    const where = await scrollForAction(c.page.cdp(), click(), 1, c.deps);
    assert.deepEqual(where, { x: 500, y: 100 });
    assert.deepEqual(c.located, []);
    assert.deepEqual(c.slept, [], "the page was already there: nothing to wait for");
  });

  it("falls back to the picture when the page does not agree the point is on the control", async () => {
    // Something else covers the control's new place.
    const c = setup({ fieldY: 3956, scrollY: 5000 });
    c.page.hitAt = () => null;
    const where = await scrollForAction(c.page.cdp(), click(), 1, c.deps);
    assert.deepEqual(c.located, ["s2a5"]);
    assert.deepEqual(where, { x: 111, y: 222 });
  });

  it("falls back to the picture when the control is gone, and refuses when that fails too", async () => {
    const c = setup({ fieldY: 3956, scrollY: 5000 });
    c.field.remove();
    assert.deepEqual(await scrollForAction(c.page.cdp(), click(), 1, c.deps), { x: 111, y: 222 });
    c.deps.locate = () => Promise.resolve(null);
    await assert.rejects(
      scrollForAction(c.page.cdp(), click(), 1, c.deps),
      /changed shape since the survey .* could not be found again/,
    );
  });

  it("does not guess when the point would lie outside the window", async () => {
    // A window too short to hold the point where it lies 100 px from the top of the screen it was aimed on.
    const c = setup({ fieldY: 3956, scrollY: 5000 });
    c.page.viewHeight = 90;
    await scrollForAction(c.page.cdp(), click(), 1, c.deps);
    assert.deepEqual(c.located, ["s2a5"]);
    assert.deepEqual(c.held, [], "the page was not asked about a point outside the window");
  });

  it("acts as before on a point bound to no control when the page cannot say where it went", async () => {
    const c = setup({ fieldY: 3956, scrollY: 5000 });
    const where = await scrollForAction(c.page.cdp(), click({ mark: undefined }), 1, c.deps);
    assert.deepEqual(c.located, ["s2a5"]);
    assert.deepEqual(where, { x: 111, y: 222 });
    assert.deepEqual(c.held, []);
  });

  it("leaves a point bound to no control where it was when the page grew below it", async () => {
    // The page is 76 px taller, but the controls say the growth is below the point: nothing moved it.
    const c = setup({ fieldY: 3880, scrollY: 5000 });
    c.shift = 0;
    const where = await scrollForAction(c.page.cdp(), click({ mark: undefined }), 1, c.deps);
    assert.deepEqual(where, { x: 500, y: 100 });
    assert.equal(c.page.scrollY, 3800);
    assert.deepEqual(c.located, [], "no picture was searched");
  });

  it("moves a point bound to no control by the growth above it, window and all", async () => {
    const c = setup({ fieldY: 3956, scrollY: 5000 });
    c.shift = 76;
    const where = await scrollForAction(c.page.cdp(), click({ mark: undefined }), 1, c.deps);
    assert.deepEqual(where, { x: 500, y: 100 }, "the point keeps its place in the window");
    assert.equal(c.page.scrollY, 3876);
    assert.deepEqual(c.located, []);
  });

  it("searches the picture for a point bound to no control that lies where something appeared", async () => {
    const c = setup({ fieldY: 3956, scrollY: 5000 });
    c.shift = null;
    const where = await scrollForAction(c.page.cdp(), click({ mark: undefined }), 1, c.deps);
    assert.deepEqual(c.located, ["s2a5"]);
    assert.deepEqual(where, { x: 111, y: 222 });
  });

  it("acts as before on a page of the height the survey saw", async () => {
    const c = setup({ fieldY: 3880, scrollY: 5000, pageHeight: 6000 });
    const where = await scrollForAction(c.page.cdp(), click(), 1, c.deps);
    assert.deepEqual(where, { x: 500, y: 100 });
    assert.deepEqual(c.located, []);
    assert.equal(c.page.scrollY, 3800);
    assert.ok(c.slept.includes(350), "the page moved, so it was given a moment to load");
  });

  it("reads the plan in the screenshot's pixels", async () => {
    const c = setup({ fieldY: 3956, scrollY: 5000 });
    const half = click({
      x: 250,
      y: 50,
      scrollTo: 1900,
      pageHeight: 3000,
      mark: { id: PLANNED.id, x: 200, y: 1940, w: 150, h: 20 },
    });
    const where = await scrollForAction(c.page.cdp(), half, 0.5, c.deps);
    assert.deepEqual(where, { x: 500, y: 100 });
    assert.equal(c.page.scrollY, 3876);
  });
});

describe("where a survey's screens begin", () => {
  it("steps one screen less the overlap at a time, to the very bottom", () => {
    assert.deepEqual(surveyPositions(2400, 800), [0, 800 - SURVEY_OVERLAP_PX, 1540, 1600]);
    assert.deepEqual(surveyPositions(900, 800), [], "about one screen tall");
  });

  it("begins a screen above a control its edge would cut, so the control is whole on it", () => {
    // A 105 px field straddles the second screen's top edge at 770: the screen begins above it.
    const controls = [
      { y: 300, h: 40 },
      { y: 735, h: 105 },
      { y: 1400, h: 40 },
    ];
    assert.deepEqual(surveyPositions(2400, 800, controls), [0, 734, 1504, 1600]);
  });

  it("moves up past several controls, and no further than half a screen", () => {
    const stack = [
      { y: 700, h: 100 },
      { y: 690, h: 20 },
    ];
    assert.deepEqual(surveyPositions(2400, 800, stack), [0, 689, 1459, 1600]);
    // A control that would push the screen back past half a window is left as it falls, cut.
    assert.deepEqual(surveyPositions(2400, 800, [{ y: 300, h: 600 }]), [0, 770, 1540, 1600]);
    // One taller than the window cannot be whole on any screen.
    assert.deepEqual(surveyPositions(2400, 800, [{ y: 100, h: 900 }]), [0, 770, 1540, 1600]);
  });
});

describe("what is settled when the form moved", () => {
  const settled = {
    pageHeight: 2400,
    fence: 0,
    spans: [
      { from: 0, to: 800 },
      { from: 1400, to: 2000 },
    ],
  };

  it("follows the controls, and does not settle what appeared", () => {
    const placed = settledStill(settled, 2480, 1, [{ from: 1500, at: 1600, dy: 80 }]);
    assert.deepEqual(placed?.spans, [
      { from: 0, to: 800 },
      { from: 1400, to: 1500 },
      { from: 1680, to: 2080 },
    ]);
    assert.equal(placed?.pageHeight, 2480);
  });

  it("keeps them all when the page grew at the bottom and no control moved", () => {
    assert.deepEqual(settledStill(settled, 2600, 1, []), { ...settled, pageHeight: 2600 });
    assert.deepEqual(settledStill(settled, 2600, 1, null)?.spans, settled.spans);
    assert.equal(
      settledStill(settled, 2405, 1, null),
      settled,
      "within the tolerance it is the same page",
    );
  });

  it("cuts the bottom off when the page shrank and nothing moved", () => {
    assert.deepEqual(settledStill(settled, 1500, 1, null)?.spans, [
      { from: 0, to: 800 },
      { from: 1400, to: 1500 },
    ]);
  });

  it("is none when nothing was settled or nothing is left", () => {
    assert.equal(settledStill(null, 100, 1, null), null);
    assert.equal(settledStill({ ...settled, spans: [] }, 100, 1, null), null);
    assert.equal(settledStill(settled, 2400, 1, [{ from: 0, at: 0, dy: -9000 }]), null);
  });

  it("is told to the run's scrolling in the page's pixels, moved and cut as the controls were", () => {
    const keeper = new SurveyKeeper();
    keeper.seen({ dataUrl: "", scale: 0.5, viewport: { height: 400 } } as unknown as Shot);
    keeper.setSettled({
      pageHeight: 1200,
      fence: 0,
      spans: [
        { from: 0, to: 400 },
        { from: 700, to: 1000 },
      ],
    });
    // The settled parts are in screenshot pixels, half a CSS pixel; the move is in CSS pixels: a gap from
    // 750 to 800, below which everything moved 80.
    keeper.noteLayout([{ from: 750, at: 800, dy: 80 }]);
    assert.deepEqual(keeper.blue(2480)?.spans, [
      { from: 0, to: 750 },
      { from: 1480, to: 2080 },
    ]);
    keeper.setSettled({ pageHeight: 1240, fence: 0, spans: [{ from: 0, to: 400 }] });
    assert.deepEqual(
      keeper.blue(2480)?.spans,
      [{ from: 0, to: 800 }],
      "the agent's stretches already match the page",
    );
  });
});

describe("a field still to fill", () => {
  it("adds no screen when a kept screen shows it clear of its edges", () => {
    assert.deepEqual(focusPositions([0, 770], [400, 1200], 2400, 800), []);
  });

  it("adds a screen centred on a field that sits at a screen's edge", () => {
    // 1550 lies 10 px above the bottom of the screen at 770 and is not on another kept screen.
    assert.deepEqual(focusPositions([0, 770], [1550], 3000, 800), [1150]);
  });

  it("adds one for a field in a part the survey leaves out, and one screen serves two fields close together", () => {
    assert.deepEqual(focusPositions([0], [2000, 2050], 3000, 800), [1600]);
  });

  it("keeps an added screen on the page", () => {
    assert.deepEqual(focusPositions([0], [2990], 3000, 800), [2200]);
    assert.deepEqual(focusPositions([800], [10], 3000, 800), [0]);
  });

  it("asks for a field to lie at least the edge margin inside a screen", () => {
    assert.ok(SURVEY_FOCUS_EDGE_PX > 0);
    assert.deepEqual(focusPositions([0], [800 - SURVEY_FOCUS_EDGE_PX], 3000, 800), []);
    assert.equal(focusPositions([0], [800 - SURVEY_FOCUS_EDGE_PX + 1], 3000, 800).length, 1);
  });
});

describe("a screen the batch just carried out acted on", () => {
  const zones = [{ zone: 3, screenshot: "data:,", scrollY: 3984 }];
  it("is one that shares any of the page with a zone photographed when the zone was done", () => {
    assert.equal(actedOn(3984, zones, 823), true);
    assert.equal(actedOn(3645, zones, 823), true);
    assert.equal(actedOn(4800, zones, 823), true);
  });
  it("is not one that begins where the zone's photo ends, or lies elsewhere", () => {
    assert.equal(actedOn(4807, zones, 823), false);
    assert.equal(actedOn(2000, zones, 823), false);
    assert.equal(actedOn(3984, [], 823), false);
  });
});
