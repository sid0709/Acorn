import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readOpenList } from "../../src/agent/page-info.ts";

import { FakeElement, FakePage } from "./fake-page.ts";

/** A dropdown the page draws itself: a combobox input, and its list of options when it is open. */
function dropdown(page: FakePage, options: string[], open = true): FakeElement {
  const input = page.body.add(
    "input",
    { x: 263, y: 4840, w: 2, h: 20 },
    { role: "combobox", "aria-controls": "race-list", "aria-expanded": open ? "true" : "false" },
  );
  if (open) {
    const list = page.body.add(
      "div",
      { x: 248, y: 4870, w: 540, h: 280 },
      { role: "listbox", id: "race-list" },
    );
    options.forEach((text, i) => {
      const option = list.add(
        "div",
        { x: 248, y: 4875 + 33 * i, w: 540, h: 33 },
        { role: "option" },
      );
      option.textContent = text;
    });
  }
  return input;
}

const RACES = [
  "Black or of African descent",
  "East Asian",
  "Hispanic, Latinx or of Spanish Origin",
  "South Asian",
];

describe("the list of choices open on the page", () => {
  it("is the options the focused control's list names, in the order they are drawn", async () => {
    const page = new FakePage();
    page.activeElement = dropdown(page, RACES);
    const list = await readOpenList(page.cdp());
    assert.deepEqual(list?.options, RACES);
  });

  it("says where each option is drawn, in the screenshot's pixels, so the pick can click it", async () => {
    const page = new FakePage();
    page.activeElement = dropdown(page, RACES);
    const list = await readOpenList(page.cdp(), 2);
    assert.equal(list?.boxes?.length, RACES.length);
    // The second option: its own box, at twice the CSS size for a screenshot of two pixels per CSS pixel.
    assert.deepEqual(list?.boxes?.[1], { x: 496, y: (4875 + 33) * 2, w: 1080, h: 66 });
  });

  it("is the one drawn list when nothing says which, and leaves out what is hidden or disabled", async () => {
    const page = new FakePage();
    const input = dropdown(page, RACES);
    input.attributes = { role: "combobox" };
    const [, east, hispanic] = page.matching("[role=option]");
    if (east) east.style.display = "none";
    if (hispanic) hispanic.attributes["aria-disabled"] = "true";
    assert.deepEqual((await readOpenList(page.cdp()))?.options, [
      "Black or of African descent",
      "South Asian",
    ]);
  });

  it("is empty for a list that is open with nothing in it, and null when no list is open", async () => {
    const page = new FakePage();
    page.activeElement = dropdown(page, []);
    assert.deepEqual((await readOpenList(page.cdp()))?.options, []);
    const closed = new FakePage();
    closed.activeElement = dropdown(closed, RACES, false);
    assert.equal(await readOpenList(closed.cdp()), null);
  });

  it("is the drawn list nearest below the focused control when there are several", async () => {
    const page = new FakePage();
    const other = page.body.add("div", { x: 0, y: 100, w: 300, h: 100 }, { role: "listbox" });
    other.add("div", { x: 0, y: 100, w: 300, h: 30 }, { role: "option" }).textContent = "Elsewhere";
    const input = dropdown(page, RACES);
    input.attributes = { role: "combobox" };
    page.activeElement = input;
    assert.deepEqual((await readOpenList(page.cdp()))?.options, RACES);
  });

  it("is null when the page cannot be asked", async () => {
    const page = new FakePage();
    const broken = { ...page.cdp(), send: () => Promise.reject(new Error("gone")) };
    assert.equal(await readOpenList(broken), null);
  });
});
