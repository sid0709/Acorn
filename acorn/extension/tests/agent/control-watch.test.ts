import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { marksForAgent } from "../../src/agent/control-marks.ts";
import { ControlWatch, waitForQuiet } from "../../src/agent/control-watch.ts";

import { FakeElement, FakePage } from "./fake-page.ts";

type Form = {
  page: FakePage;
  first: FakeElement;
  country: FakeElement;
  back: FakeElement;
  submit: FakeElement;
  banner: FakeElement;
};

/** A form: a text box with a label above it, a dropdown whose tiny input sits in its left end, two buttons in a row, and a cookie bar fixed to the window. */
function form(): Form {
  const page = new FakePage();
  const wrapper = page.body.add("div", { x: 380, y: 270, w: 340, h: 90 });
  const first = wrapper.add(
    "input",
    { x: 400, y: 300, w: 300, h: 40 },
    { type: "text", name: "first_name" },
  );
  first.labels = [
    Object.assign(new FakeElement(page, "label", { x: 0, y: 0, w: 1, h: 1 }), {
      textContent: "First Name *",
    }),
  ];

  const shell = page.body.add("div", { x: 400, y: 470, w: 400, h: 70 });
  const control = shell.add("div", { x: 400, y: 495, w: 400, h: 45 });
  const country = control.add(
    "input",
    { x: 425, y: 500, w: 2, h: 20 },
    { role: "combobox", id: "country" },
  );

  const row = page.body.add("div", { x: 380, y: 800, w: 400, h: 60 });
  const back = row.add("button", { x: 400, y: 810, w: 80, h: 40 });
  back.textContent = "Back";
  const submit = row.add("button", { x: 600, y: 810, w: 180, h: 40 }, { type: "submit" });
  submit.textContent = "Submit application";

  const bar = page.body.add("div", { x: 0, y: 700, w: 1280, h: 60 });
  bar.style.position = "fixed";
  const banner = bar.add("button", { x: 1000, y: 710, w: 100, h: 40 });
  banner.textContent = "Accept";

  const hidden = page.body.add(
    "input",
    { x: 400, y: 900, w: 300, h: 40 },
    { type: "text", name: "ghost" },
  );
  hidden.style.display = "none";
  page.body.add("input", { x: 400, y: 950, w: 0, h: 40 }, { type: "text", name: "flat" });
  return { page, first, country, back, submit, banner };
}

/**
 * A dropdown that marks all that apply: its input is drawn without a size until something is typed into
 * it, inside the row a person clicks (which sits inside the bordered box with the question).
 */
function sizeless(page: FakePage): { input: FakeElement; row: FakeElement } {
  const box = page.body.add("div", { x: 248, y: 1300, w: 540, h: 60 });
  const row = box.add("div", { x: 248, y: 1320, w: 540, h: 38 });
  const holder = row.add("div", { x: 262, y: 1324, w: 0, h: 0 });
  const input = holder.add(
    "input",
    { x: 262, y: 1324, w: 0, h: 0 },
    { role: "combobox", id: "race" },
  );
  return { input, row };
}

/** A bordered field whose question is printed inside it: the input is the whole box, the label its top 70 px. */
function innerLabelled(page: FakePage): FakeElement {
  const sponsorship = page.body.add(
    "input",
    { x: 240, y: 1100, w: 540, h: 100 },
    { type: "text", name: "sponsorship", required: "", "aria-invalid": "true" },
  );
  const words = new FakeElement(page, "label", { x: 250, y: 1105, w: 500, h: 65 });
  words.textContent = "Will you require sponsorship? *";
  sponsorship.labels = [words];
  return sponsorship;
}

describe("the page's list of controls", () => {
  it("is every drawn control that is not fixed to the window, with its kind, its place and its field", async () => {
    const { page } = form();
    const watch = new ControlWatch();
    assert.equal(await watch.read(page.cdp()), true);
    assert.deepEqual(
      watch.marks.map((mark) => [mark.id, mark.kind]),
      [
        ["input:text:first_name:First Name *", "input"],
        ["input::country:", "select"],
        ["button:::Back", "button"],
        ["button:submit::Submit application", "button"],
      ],
    );
    const [first, country, back] = watch.marks;
    assert.deepEqual([first?.x, first?.y, first?.w, first?.h], [400, 300, 300, 40]);
    assert.deepEqual(
      first?.box,
      { x: 380, y: 270, w: 340, h: 90 },
      "the wrapper holds this control alone",
    );
    assert.deepEqual(
      country?.box,
      { x: 400, y: 470, w: 400, h: 70 },
      "the field round a tiny input is the whole dropdown",
    );
    assert.equal(back?.box, undefined, "a row of two buttons is no button's own field");
  });

  it("says what the page calls each control, and what it says of its state", async () => {
    const { page, first, country } = form();
    first.value = "Ada";
    country.attributes["aria-required"] = "true";
    const watch = new ControlWatch();
    await watch.read(page.cdp());
    const [name, dropdown, back, submit] = watch.marks;
    assert.equal(name?.label, "First Name *");
    assert.equal(name?.empty, false, "a text box with text in it");
    assert.equal(name?.required, undefined);
    assert.equal(dropdown?.required, true);
    assert.equal(dropdown?.empty, undefined, "a dropdown the page draws keeps its value elsewhere");
    assert.equal(back?.label, "Back");
    assert.equal(back?.empty, undefined, "a button holds no value");
    assert.equal(submit?.label, "Submit application");
    assert.equal(name?.entry, undefined, "a label above the box leaves the whole box as the entry");
  });

  it("tells the person what each control shows and which choices answer one question, and the agent none of it", async () => {
    const page = new FakePage();
    const add = (tag: string, y: number, attributes: Record<string, string>, parent = page.body) =>
      parent.add(tag, { x: 10, y, w: 300, h: 30 }, attributes);
    add("input", 100, { type: "text", name: "name" }).value = "Ada   Lovelace ";
    add("input", 140, { type: "password", name: "pw" }).value = "hunter2";
    add("input", 180, { type: "text", name: "card", autocomplete: "billing cc-number" }).value =
      "4111111111111111";
    const country = add("select", 220, { name: "country" });
    country.value = "nz";
    const chosen = new FakeElement(page, "option", { x: 0, y: 0, w: 1, h: 1 });
    chosen.textContent = "New Zealand";
    country.selectedOptions = [chosen];
    add("select", 260, { name: "state" }).selectedOptions = [chosen];
    add("input", 300, { type: "file", name: "resume" }).files = [{ name: "resume.pdf" }];
    const set = page.body.add("fieldset", { x: 0, y: 340, w: 400, h: 100 });
    add("legend", 340, {}, set).textContent = "Are you authorized to work here?";
    add("input", 370, { type: "radio", name: "auth", "aria-label": "Yes" }, set).checked = true;
    add("input", 400, { type: "radio", name: "auth", "aria-label": "No" }, set);
    add("input", 460, { type: "checkbox", name: "days", "aria-label": "Mon" }).checked = true;
    add("input", 490, { type: "checkbox", name: "days", "aria-label": "Tue" });
    add("input", 520, { type: "checkbox", name: "agree", "aria-label": "I agree" });
    const shift = page.body.add("div", { x: 0, y: 560, w: 400, h: 80 }, { role: "radiogroup" });
    shift.attributes["aria-label"] = "Preferred shift";
    add("div", 570, { role: "radio", "aria-label": "Day", "aria-checked": "true" }, shift);
    add("div", 600, { role: "radio", "aria-label": "Night", "aria-checked": "false" }, shift);

    const watch = new ControlWatch();
    await watch.read(page.cdp());
    const mark = (id: string) => watch.marks.find((one) => one.id === id);
    assert.equal(mark("input:text:name:")?.value, "Ada Lovelace");
    assert.equal(mark("input:password:pw:")?.value, undefined, "a password is never read");
    assert.equal(mark("input:text:card:")?.value, undefined, "nor a card's number");
    assert.equal(mark("select::country:")?.value, "New Zealand");
    assert.equal(mark("select::state:")?.value, undefined, "a list on its empty prompt shows none");
    assert.equal(mark("input:file:resume:")?.value, "resume.pdf");
    assert.deepEqual(
      ["input:radio:auth:Yes", "input:radio:auth:No"].map((id) => {
        const one = mark(id);
        return [one?.group, one?.question, one?.checked];
      }),
      [
        ["radio:auth", "Are you authorized to work here?", true],
        ["radio:auth", "Are you authorized to work here?", false],
      ],
    );
    assert.equal(mark("input:checkbox:days:Mon")?.group, "checkbox:days");
    assert.equal(mark("input:checkbox:agree:I agree")?.group, undefined, "a check box alone");
    assert.equal(mark("input:checkbox:agree:I agree")?.checked, false);
    assert.deepEqual(
      [mark("div:::Day")?.group, mark("div:::Day")?.question, mark("div:::Day")?.checked],
      ["radiogroup:1", "Preferred shift", true],
    );
    assert.equal(mark("div:::Night")?.checked, false);
    for (const told of marksForAgent(watch.marks, 2)) {
      assert.deepEqual(
        [told.value, told.checked, told.group, told.question],
        [undefined, undefined, undefined, undefined],
        "the agent reads the page from its pictures",
      );
    }
  });

  it("collects the list again as the person types, which the observers do not see", async () => {
    const page = new FakePage();
    const name = page.body.add(
      "input",
      { x: 10, y: 100, w: 300, h: 30 },
      { type: "text", name: "name" },
    );
    const cdp = page.cdp();
    const watch = new ControlWatch();
    await watch.read(cdp);
    name.value = "Ada";
    page.dispatch("input");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(await watch.read(cdp), true);
    assert.equal(watch.marks[0]?.value, "Ada");
  });

  it("gives a control whose label is printed inside its box the line under the words as its entry", async () => {
    const { page } = form();
    innerLabelled(page);
    const watch = new ControlWatch();
    await watch.read(page.cdp());
    const field = watch.marks.find((mark) => mark.id.includes("sponsorship"));
    assert.deepEqual(field?.entry, { x: 240, y: 1170, w: 540, h: 30 });
    assert.equal(field?.required, true);
    assert.equal(field?.empty, true);
    assert.equal(field?.invalid, true);
  });

  it("gives a control drawn without a size the box of the row it sits on, and finds it there again", async () => {
    const { page } = form();
    const { row } = sizeless(page);
    const watch = new ControlWatch();
    await watch.read(page.cdp());
    const mark = watch.marks.find((one) => one.id === "input::race:");
    assert.deepEqual(
      [mark?.x, mark?.y, mark?.w, mark?.h],
      [248, 1320, 540, 38],
      "the row, not the sizeless input",
    );
    assert.equal(mark?.kind, "select");
    assert.deepEqual(
      await watch.move(page.cdp(), { id: "input::race:", x: 248, y: 1320, w: 540, h: 38 }, 1),
      { dx: 0, dy: 0 },
    );
    row.box = { ...row.box, y: 1400 };
    assert.deepEqual(
      await watch.move(page.cdp(), { id: "input::race:", x: 248, y: 1320, w: 540, h: 38 }, 1),
      { dx: 0, dy: 80 },
      "the row's move is the control's",
    );
  });

  it("counts the page's scroll in a control's place", async () => {
    const { page } = form();
    page.scrollY = 120;
    const watch = new ControlWatch();
    await watch.read(page.cdp());
    assert.equal(watch.marks[0]?.y, 300, "a place on the page, not in the window");
  });

  it("tells controls that look alike apart by their order, and trusts an id only while the count is the same", async () => {
    const page = new FakePage();
    for (const y of [100, 200, 300])
      page.body.add("button", { x: 10, y, w: 50, h: 30 }).textContent = "Add";
    page.body.add("a", { x: 10, y: 400, w: 50, h: 30 }, { href: "/x" }).textContent = "Terms";
    const watch = new ControlWatch();
    await watch.read(page.cdp());
    assert.deepEqual(
      watch.marks.map((mark) => mark.id),
      ["button:::Add#1/3", "button:::Add#2/3", "button:::Add#3/3", "a:::Terms"],
    );
  });

  it("leaves the marks out of a read when nothing changed, and keeps the list it has", async () => {
    const { page } = form();
    const cdp = page.cdp();
    const watch = new ControlWatch();
    await watch.read(cdp);
    const before = watch.marks;
    assert.equal(await watch.read(cdp), false);
    assert.equal(watch.marks, before);
    assert.equal(
      await watch.read(cdp, { fresh: true }),
      false,
      "collecting again finds the same page",
    );
  });

  it("puts the observers in a page that has none and takes an older build's off", async () => {
    const { page } = form();
    let stopped = 0;
    page.window.__acornControlMarks = {
      installed: true,
      build: "older",
      stop: () => (stopped += 1),
    };
    const watch = new ControlWatch();
    assert.equal(await watch.read(page.cdp()), true);
    assert.equal(stopped, 1);
    assert.equal(watch.marks.length, 4);
    assert.equal(page.observers.length, 2, "one for changes, one for size");
  });
});

describe("where the form moved", () => {
  it("is measured from the list the agent was last told of", async () => {
    const { page, country, back, submit } = form();
    const cdp = page.cdp();
    const watch = new ControlWatch();
    await watch.read(cdp);
    assert.equal(watch.moves(), null, "the agent has been told nothing yet");
    watch.commit(watch.marks);
    assert.deepEqual(watch.moves(), []);

    // A message appeared under the first field: the dropdown and what is below it moved 30 px.
    for (const el of [country, back, submit]) el.box = { ...el.box, y: el.box.y + 30 };
    page.mutated();
    assert.equal(await watch.read(cdp, { fresh: true }), true);
    assert.deepEqual(watch.moves(), [{ from: 340, at: 500, dy: 30 }]);

    // The agent was told of that list: the next move is measured from it.
    watch.commit(watch.marks);
    assert.deepEqual(watch.moves(), []);
    watch.forget();
    assert.equal(watch.moves(), null);
  });

  it("places a point of the last survey by the moves since it, whatever the agent was told between", async () => {
    const { page, country, back, submit } = form();
    const cdp = page.cdp();
    const watch = new ControlWatch();
    assert.equal(watch.shiftSince(320), null, "no survey yet");
    await watch.read(cdp);
    watch.survey(watch.marks);
    watch.commit(watch.marks);
    assert.equal(watch.shiftSince(320), 0);
    for (const el of [country, back, submit]) el.box = { ...el.box, y: el.box.y + 30 };
    page.mutated();
    await watch.read(cdp, { fresh: true });
    // A look between told the agent of the moved list; the survey's page is still what the plan measures on.
    watch.commit(watch.marks);
    assert.deepEqual(watch.moves(), []);
    assert.equal(watch.shiftSince(320), 0, "above the growth");
    assert.equal(watch.shiftSince(420), null, "in the gap where something appeared");
    assert.equal(watch.shiftSince(830), 30, "below it");
    watch.forget();
    assert.equal(watch.shiftSince(830), null);
  });
});

describe("the control a point was bound to", () => {
  const ref = { id: "input:text:first_name:First Name *", x: 400, y: 300, w: 300, h: 40 };

  it("is found where it is now, and the move is how far the point goes", async () => {
    const { page, first } = form();
    const watch = new ControlWatch();
    assert.deepEqual(await watch.move(page.cdp(), ref, 1), { dx: 0, dy: 0 });
    first.box = { x: 400, y: 376, w: 300, h: 40 };
    assert.deepEqual(await watch.move(page.cdp(), ref, 1), { dx: 0, dy: 76 });
    // The reference is in the screenshot's pixels: half a pixel of screenshot to a pixel of page.
    assert.deepEqual(await watch.move(page.cdp(), { ...ref, x: 200, y: 150, w: 150, h: 20 }, 0.5), {
      dx: 0,
      dy: 76,
    });
  });

  it("is not told when it is gone, another shape, or moved only by what the page calls itself", async () => {
    const { page, first } = form();
    const watch = new ControlWatch();
    first.box = { x: 400, y: 300, w: 300, h: 80 };
    assert.equal(
      await watch.move(page.cdp(), ref, 1),
      null,
      "a taller box than the point was aimed at",
    );
    first.box = { x: 400, y: 300, w: 300, h: 40 };
    first.remove();
    assert.equal(await watch.move(page.cdp(), ref, 1), null);
    assert.equal(await watch.move(page.cdp(), { ...ref, id: "input:text:nobody:" }, 1), null);
  });

  it("holds a point that lies on the control, its label or the gap round it, and no other", async () => {
    const { page, first, country } = form();
    const watch = new ControlWatch();
    const wrapper = first.parentElement;
    const shell = country.parentElement?.parentElement;
    const cdp = page.cdp();
    const holds = (id: string, hit: FakeElement | null) => {
      page.hitAt = () => hit;
      return watch.holds(cdp, { id, x: 0, y: 0, w: 1, h: 1 }, 500, 320);
    };
    assert.equal(await holds(ref.id, first), true, "the control itself");
    assert.equal(await holds(ref.id, wrapper), true, "its field, which holds no other control");
    assert.equal(await holds(ref.id, null), false, "nothing is there");
    assert.equal(await holds(ref.id, page.body), false, "the page holds every control");
    assert.equal(await holds(ref.id, country), false, "another control");
    assert.equal(
      await holds("input::country:", country.parentElement),
      true,
      "the body of a dropdown, not its tiny input",
    );
    assert.equal(await holds("input::country:", shell ?? null), true);
    assert.equal(await holds("input:text:nobody:", first), false, "no such control");
  });

  it("does not hold a point in a field as tall as a section of the page", async () => {
    const { page, first } = form();
    const watch = new ControlWatch();
    const wrapper = first.parentElement;
    if (wrapper) wrapper.box = { x: 0, y: 0, w: 1280, h: 600 };
    page.hitAt = () => wrapper;
    assert.equal(
      await watch.holds(
        page.cdp(),
        { id: "input:text:first_name:First Name *", x: 0, y: 0, w: 1, h: 1 },
        5,
        5,
      ),
      false,
    );
  });
});

describe("waiting for the page to go quiet", () => {
  it("returns once the page has been still for a moment, well before the longest wait", async () => {
    const { page } = form();
    const began = Date.now();
    assert.equal(await waitForQuiet(page.cdp(), 1000, 0), true);
    const waited = Date.now() - began;
    assert.ok(waited >= 80 && waited < 600, `waited ${waited} ms`);
  });

  it("waits for a page that is still changing, and gives up at the longest wait", async () => {
    const { page } = form();
    const cdp = page.cdp();
    await new ControlWatch().read(cdp);
    const busy = setInterval(() => page.mutated(), 20);
    const began = Date.now();
    const done = await waitForQuiet(cdp, 250, 0);
    clearInterval(busy);
    const waited = Date.now() - began;
    assert.equal(done, true);
    assert.ok(waited >= 230 && waited < 600, `waited ${waited} ms`);
  });

  it("does not count typing as the page being busy", async () => {
    const { page } = form();
    const cdp = page.cdp();
    await new ControlWatch().read(cdp);
    const typing = setInterval(() => page.dispatch("input"), 20);
    const began = Date.now();
    const done = await waitForQuiet(cdp, 1000, 0);
    clearInterval(typing);
    assert.equal(done, true);
    assert.ok(Date.now() - began < 600, "the wait is the quiet page's, not the longest");
  });

  it("waits for an animation of the page to end, but not for the cursor's own or one that never ends", async () => {
    const { page } = form();
    const cdp = page.cdp();
    await new ControlWatch().read(cdp);
    const inPage = { getRootNode: () => page.document };
    const inOverlay = { getRootNode: () => ({}) };
    const animation = (target: { getRootNode: () => unknown }, endTime: number) => ({
      playState: "running",
      effect: { target, getComputedTiming: () => ({ endTime }) },
    });
    page.animations = [animation(inOverlay, 5000), animation(inPage, Number.POSITIVE_INFINITY)];
    const began = Date.now();
    assert.equal(await waitForQuiet(cdp, 1000, 0), true);
    assert.ok(
      Date.now() - began < 600,
      "an overlay's animation and an endless one are not waited for",
    );

    page.animations = [animation(inPage, 400)];
    const again = Date.now();
    await waitForQuiet(cdp, 300, 0);
    assert.ok(
      Date.now() - again >= 280,
      "a finite animation of the page is waited for, up to the longest wait",
    );
  });

  it("does not know what a hidden tab does, and says so", async () => {
    const { page } = form();
    page.visibilityState = "hidden";
    assert.equal(await waitForQuiet(page.cdp(), 300), false);
  });

  it("does not know when the page cannot be asked", async () => {
    const { page } = form();
    const cdp = page.cdp();
    const broken = {
      ...cdp,
      send: () => Promise.reject(new Error("Execution context was destroyed")),
    };
    assert.equal(await waitForQuiet(broken, 300), false);
    const watch = new ControlWatch();
    assert.equal(await watch.read(broken), false);
    assert.equal(await watch.move(broken, { id: "x", x: 0, y: 0, w: 1, h: 1 }, 1), null);
    assert.equal(await watch.holds(broken, { id: "x", x: 0, y: 0, w: 1, h: 1 }, 1, 1), false);
  });
});
