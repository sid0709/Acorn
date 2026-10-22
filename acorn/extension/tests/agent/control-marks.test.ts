import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cropSpans,
  layoutMoves,
  marksForAgent,
  markMove,
  moved,
  parseMarks,
  placeSpans,
  scaleMoves,
  shiftAt,
  type ControlMark,
} from "../../src/agent/control-marks.ts";

/** A control with a top and a height; the rest of its box does not matter to where the form moved. */
function mark(id: string, y: number, h = 40, x = 400): ControlMark {
  return { id, kind: "input", x, y, w: 300, h };
}

/** The page: two fields, a long paragraph, a third field and a button. */
const PAGE: ControlMark[] = [
  mark("first", 100),
  mark("second", 200),
  mark("third", 600),
  mark("send", 900, 50),
];

/** The same page with everything from `y` down moved by `dy`. */
function pushed(page: ControlMark[], y: number, dy: number): ControlMark[] {
  return page.map((one) => (one.y >= y ? { ...one, y: one.y + dy } : one));
}

describe("layoutMoves", () => {
  it("says nothing moved when no control did", () => {
    assert.deepEqual(layoutMoves(PAGE, PAGE), []);
    assert.deepEqual(
      layoutMoves(PAGE, pushed(PAGE, 0, 1)),
      [],
      "a pixel of rounding is not a move",
    );
  });

  it("knows nothing without a list on either side", () => {
    assert.equal(layoutMoves([], PAGE), null);
    assert.equal(layoutMoves(PAGE, []), null);
    assert.equal(layoutMoves(PAGE, [mark("other", 100)]), null, "no control is in both lists");
  });

  it("puts the gap between the last control that stayed and the first that moved", () => {
    // A message appeared under the second field: the third field and what is below it moved 30 px.
    const after = pushed(PAGE, 600, 30);
    assert.deepEqual(layoutMoves(PAGE, after), [{ from: 240, at: 600, dy: 30 }]);
  });

  it("reads several insertions down the page as several moves", () => {
    const after = pushed(pushed(PAGE, 200, 20), 900, 80);
    assert.deepEqual(layoutMoves(PAGE, after), [
      { from: 140, at: 200, dy: 20 },
      { from: 640, at: 900, dy: 100 },
    ]);
  });

  it("reads a removal as a move up, and a return to where things were as a move back", () => {
    assert.deepEqual(layoutMoves(PAGE, pushed(PAGE, 600, -40)), [{ from: 240, at: 600, dy: -40 }]);
    const there = pushed(PAGE, 200, 50).map((one) =>
      one.id === "send" ? { ...one, y: 900 } : one,
    );
    assert.deepEqual(layoutMoves(PAGE, there), [
      { from: 140, at: 200, dy: 50 },
      { from: 640, at: 900, dy: 0 },
    ]);
  });

  it("leaves a control that appeared, or went, out of it", () => {
    const after = [...pushed(PAGE, 600, 30).filter((one) => one.id !== "second"), mark("new", 250)];
    assert.deepEqual(layoutMoves(PAGE, after), [{ from: 140, at: 600, dy: 30 }]);
  });

  it("puts the gap above the first control when every control moved", () => {
    // Nothing above the first control to say where it began: it began anywhere above.
    assert.deepEqual(layoutMoves(PAGE, pushed(PAGE, 0, 50)), [{ from: 0, at: 100, dy: 50 }]);
  });

  it("ignores the rounding of a place but not a real move beside it", () => {
    const after = PAGE.map((one) => ({ ...one, y: one.y + (one.y >= 600 ? 31 : 1.5) }));
    assert.deepEqual(layoutMoves(PAGE, after), [{ from: 240, at: 600, dy: 31 }]);
  });

  it("leaves a control fixed to the window out of it: its place is in the window, not on the page", () => {
    // A dialog's button sits 300 px down the window on both lists while the form below 600 moved 30 px; a
    // page-anchored control at that height would have moved too, and a fixed one must not look like a move back.
    const dialog = { ...mark("autofill", 300), fixed: true };
    const after = [...pushed(PAGE, 600, 30), dialog];
    assert.deepEqual(layoutMoves([...PAGE, dialog], after), [{ from: 240, at: 600, dy: 30 }]);
    assert.equal(
      layoutMoves([dialog], [dialog]),
      null,
      "fixed controls alone say nothing of the form",
    );
  });
});

describe("placeSpans", () => {
  const span = (from: number, to: number) => ({ from, to });

  it("leaves the stretches where they are when nothing moved", () => {
    const spans = [span(0, 800), span(1400, 2000)];
    assert.deepEqual(placeSpans(spans, []), spans);
  });

  it("moves the part below a move and cuts a stretch at the gap, so what appeared there is not settled", () => {
    const placed = placeSpans([span(0, 800), span(1400, 2000)], [{ from: 1500, at: 1600, dy: 80 }]);
    assert.deepEqual(placed, [span(0, 800), span(1400, 1500), span(1680, 2080)]);
  });

  it("places a stretch among several moves, each part where its own controls went", () => {
    const placed = placeSpans(
      [span(900, 2000)],
      [
        { from: 1000, at: 1050, dy: 30 },
        { from: 1500, at: 1560, dy: 100 },
      ],
    );
    assert.deepEqual(placed, [span(900, 1000), span(1080, 1530), span(1660, 2100)]);
  });

  it("does not settle a place that two pieces land on when the form shrank over it", () => {
    assert.deepEqual(placeSpans([span(0, 2000)], [{ from: 1000, at: 1100, dy: -150 }]), [
      span(0, 950),
      span(1000, 1850),
    ]);
  });

  it("clamps what is pushed off the top and drops what is wholly off it", () => {
    assert.deepEqual(
      placeSpans([span(100, 200), span(300, 900)], [{ from: 50, at: 50, dy: -400 }]),
      [span(0, 500)],
    );
  });

  it("keeps whatever else a stretch carries", () => {
    const [placed] = placeSpans([{ from: 0, to: 100, tag: "a" }], []);
    assert.equal(placed?.tag, "a");
  });

  it("agrees with the agent's own placing of the same moves (acorn-agent settled_test.go)", () => {
    const moves = [
      { from: 1000, at: 1100, dy: 20 },
      { from: 2000, at: 2100, dy: 50 },
    ];
    assert.deepEqual(placeSpans([span(0, 3000)], moves), [
      span(0, 1000),
      span(1120, 2020),
      span(2150, 3050),
    ]);
  });
});

describe("shiftAt", () => {
  const moves = [
    { from: 1000, at: 1100, dy: 20 },
    { from: 2000, at: 2100, dy: 50 },
  ];

  it("is nothing above the first move, each move's distance from where it began, and unknown in a gap", () => {
    assert.equal(shiftAt(moves, 500), 0);
    assert.equal(shiftAt(moves, 999), 0);
    assert.equal(shiftAt(moves, 1050), null, "something appeared here");
    assert.equal(shiftAt(moves, 1100), 20);
    assert.equal(shiftAt(moves, 1999), 20);
    assert.equal(shiftAt(moves, 2050), null);
    assert.equal(shiftAt(moves, 2100), 50);
    assert.equal(shiftAt(moves, 9000), 50);
  });

  it("is nothing anywhere when nothing moved", () => {
    assert.equal(shiftAt([], 4846), 0);
  });

  it("leaves a point above a growth far below it where it was", () => {
    // A recorded run: picking a dropdown at 5888 grew the page 76 px there; the point at 4846 did not move.
    assert.equal(shiftAt([{ from: 5862, at: 5888, dy: 76 }], 4846), 0);
    assert.equal(shiftAt([{ from: 5862, at: 5888, dy: 76 }], 5987), 76);
  });
});

describe("cropSpans", () => {
  it("cuts a stretch that reaches past the page and drops one that begins there", () => {
    assert.deepEqual(
      cropSpans(
        [
          { from: 0, to: 500 },
          { from: 900, to: 1200 },
        ],
        1000,
      ),
      [
        { from: 0, to: 500 },
        { from: 900, to: 1000 },
      ],
    );
    assert.deepEqual(cropSpans([{ from: 1000, to: 1200 }], 1000), []);
  });
});

describe("markMove", () => {
  const planned = { x: 400, y: 600, w: 300, h: 40 };

  it("says how far the control went", () => {
    assert.deepEqual(markMove(planned, { x: 400, y: 676, w: 300, h: 40 }), { dx: 0, dy: 76 });
    assert.deepEqual(markMove(planned, { x: 385, y: 590, w: 300, h: 40 }), { dx: -15, dy: -10 });
  });

  it("does not know the control when it is gone or is another shape", () => {
    assert.equal(markMove(planned, null), null);
    assert.equal(markMove(planned, undefined), null);
    assert.equal(markMove(planned, { x: 400, y: 600, w: 300, h: 60 }), null, "a taller box");
    assert.equal(markMove(planned, { x: 400, y: 600, w: 200, h: 40 }), null, "a much narrower one");
    assert.deepEqual(markMove(planned, { x: 400, y: 600, w: 290, h: 41 }), { dx: 0, dy: 0 });
  });

  it("tells a move from the rounding of a place", () => {
    assert.equal(moved({ dx: 0, dy: 2 }), false);
    assert.equal(moved({ dx: 0, dy: 3 }), true);
    assert.equal(moved({ dx: -5, dy: 0 }), true);
  });
});

describe("what the page sends and what the agent is told", () => {
  it("keeps only marks it can use", () => {
    const good = mark("a", 10);
    const list = parseMarks([
      good,
      { id: "", x: 1, y: 1, w: 1, h: 1 },
      { id: "b", x: Number.NaN, y: 1, w: 1, h: 1 },
      { id: "c", x: 1, y: 1, w: 1, h: 1, box: { x: 1 } },
      "nope",
      null,
    ]);
    assert.deepEqual(list, [good]);
    assert.equal(parseMarks("nothing"), null);
  });

  it("keeps what the page says of a control only when it is of the right shape", () => {
    const [full, bare] =
      parseMarks([
        {
          ...mark("a", 10),
          label: "First Name",
          entry: { x: 400, y: 30, w: 300, h: 20 },
          required: true,
          empty: false,
          invalid: true,
        },
        { ...mark("b", 10), label: "", entry: { x: 1 }, required: "yes", empty: "no", invalid: 0 },
      ]) ?? [];
    assert.deepEqual(full, {
      ...mark("a", 10),
      label: "First Name",
      entry: { x: 400, y: 30, w: 300, h: 20 },
      required: true,
      empty: false,
      invalid: true,
    });
    assert.deepEqual(bare, mark("b", 10));
  });

  it("keeps a control's fixed flag through the page's list and the agent's", () => {
    const parsed = parseMarks([
      { ...mark("close", 20), fixed: true },
      { ...mark("name", 400), fixed: "yes" },
    ]);
    assert.equal(parsed?.[0]?.fixed, true);
    assert.equal(parsed?.[1]?.fixed, undefined, "only a true flag is kept");
    assert.equal(marksForAgent(parsed ?? [], 0.5)[0]?.fixed, true);
    assert.equal("fixed" in (marksForAgent(parsed ?? [], 0.5)[1] ?? {}), false);
  });

  it("tells the agent the list in the screenshot's pixels, boxes included", () => {
    const told = marksForAgent(
      [
        {
          ...mark("a", 100),
          box: { x: 380, y: 70, w: 340, h: 90 },
          entry: { x: 400, y: 120, w: 300, h: 20 },
          label: "A",
        },
        mark("b", 200),
      ],
      0.5,
    );
    assert.deepEqual(told[0], {
      id: "a",
      kind: "input",
      label: "A",
      x: 200,
      y: 50,
      w: 150,
      h: 20,
      box: { x: 190, y: 35, w: 170, h: 45 },
      entry: { x: 200, y: 60, w: 150, h: 10 },
    });
    assert.equal(told[1]?.box, undefined);
    assert.deepEqual(scaleMoves([{ from: 10, at: 20, dy: 30 }], 2), [{ from: 20, at: 40, dy: 60 }]);
  });
});
