import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RUN_MAP_PHASE,
  RUN_POINT_STATE,
  type RunMap,
  type RunMapControl,
  type RunMapPoint,
} from "@acorn/shared/run-types";

import {
  QUESTION_STATUS,
  actionLine,
  needsYou,
  questionTally,
  questionsOf,
  seenAt,
} from "../../src/sidebar/run-questions.ts";

function control(id: string, y: number, rest: Partial<RunMapControl> = {}): RunMapControl {
  return { id, kind: "input", x: 100, y, w: 300, h: 40, ...rest };
}

function point(id: string, controlId: string, state: RunMapPoint["state"]): RunMapPoint {
  return { id, kind: "click", x: 110, y: 0, state, control: controlId };
}

function map(controls: RunMapControl[], points: RunMapPoint[] = []): RunMap {
  return {
    phase: RUN_MAP_PHASE.acting,
    pageWidth: 1280,
    pageHeight: 3000,
    viewTop: 0,
    viewHeight: 800,
    settled: [],
    controls,
    points,
    screens: [],
    moves: [],
  };
}

describe("the questions of the form", () => {
  it("are the model's own list once it has read the page: label, place and state from the pictures", () => {
    const withFields: RunMap = {
      ...map(
        [
          control("first", 100, { label: "First name", empty: true, required: true }),
          control("phone", 300, { label: "Phone", empty: true }),
          control("country", 400, { kind: "select", label: "Country" }),
        ],
        [
          point("a1", "phone", RUN_POINT_STATE.current),
          point("a2", "country", RUN_POINT_STATE.pending),
        ],
      ),
      fields: [
        { label: "First name", y: 120, state: "empty" },
        { label: "Email", y: 220, state: "filled" },
        { label: "Phone", y: 320, state: "empty" },
        { label: "Country", y: 420, state: "empty" },
        { label: "Tax number", y: 520, state: "needs_person" },
      ],
    };
    const questions = questionsOf(withFields);
    assert.deepEqual(
      questions.map((question) => [question.label, question.status]),
      [
        ["First name", QUESTION_STATUS.open],
        ["Email", QUESTION_STATUS.answered],
        ["Phone", QUESTION_STATUS.doing],
        ["Country", QUESTION_STATUS.next],
        ["Tax number", QUESTION_STATUS.problem],
      ],
      "the page's own `empty` is not read: the model's state is, and the plan's points say what is being done",
    );
    assert.deepEqual(questionTally(questions), { answered: 1, total: 5 });
    assert.deepEqual(
      questions.filter(needsYou).map((question) => question.label),
      ["First name", "Tax number"],
    );
    assert.deepEqual(questions[2]?.controls, ["phone"], "a question knows the control on its row");
  });

  it("lists the page's controls before the model has read it, saying where they are but not whether they are answered", () => {
    const questions = questionsOf(
      map(
        [
          control("email", 200, { label: "Email", empty: false, value: "ada@example.com" }),
          control("first", 100, { label: "First name", empty: true, required: true }),
          control("next", 900, { kind: "button", label: "Next" }),
          control("ssn", 500, { label: "Tax number", empty: false, invalid: true }),
        ],
        [point("a1", "email", RUN_POINT_STATE.done)],
      ),
    );
    assert.deepEqual(
      questions.map((question) => [question.label, question.status]),
      [
        ["First name", QUESTION_STATUS.unknown],
        ["Email", QUESTION_STATUS.unknown],
        ["Tax number", QUESTION_STATUS.unknown],
      ],
      "a button asks nothing; what the page says of a control's state, or a finished action, settles nothing",
    );
    assert.deepEqual(questionTally(questions), { answered: 0, total: 0 });
  });

  it("joins radio buttons into the one question they answer, and names a group the page did not name by its options", () => {
    const questions = questionsOf(
      map([
        control("yes", 100, {
          kind: "check",
          label: "Yes",
          group: "radio:auth",
          question: "Authorized to work?",
          checked: true,
        }),
        control("no", 130, { kind: "check", label: "No", group: "radio:auth", checked: false }),
        control("a", 200, { kind: "check", label: "Day", group: "radiogroup:1", checked: false }),
        control("b", 230, { kind: "check", label: "Night", group: "radiogroup:1", checked: false }),
        control("c", 300, { kind: "select" }),
      ]),
    );
    const [choice, days, dropdown] = questions;
    assert.equal(choice?.kind, "choice");
    assert.equal(choice?.label, "Authorized to work?");
    assert.equal(choice?.value, "Yes");
    assert.deepEqual(choice?.controls, ["yes", "no"]);
    assert.deepEqual(choice?.box, { x: 100, y: 100, w: 300, h: 70 });
    assert.deepEqual([days?.label, days?.named], ["Day / Night", true]);
    assert.deepEqual([dropdown?.label, dropdown?.named], ["Dropdown", false]);
  });
});

describe("the line that says what the run is doing", () => {
  it("names the question it acts on, or what it is busy with", () => {
    const controls = [
      control("phone", 100, { label: "Phone" }),
      control("box", 200),
      control("submit", 300, { kind: "button", label: "Submit" }),
    ];
    const say = (target: string, kind = "click") => {
      const page = map(controls, [{ ...point("a1", target, RUN_POINT_STATE.current), kind }]);
      return actionLine(page, questionsOf(page));
    };
    assert.equal(say("phone"), "Filling “Phone”");
    assert.equal(say("box"), "Filling a text box");
    assert.equal(say("submit"), "Pressing “Submit”");
    assert.equal(say("phone", "upload"), "Uploading to “Phone”");
    assert.equal(say("gone"), "Clicking on the page");
    assert.equal(
      actionLine({ ...map(controls), phase: RUN_MAP_PHASE.thinking }, []),
      "Asking the model what to do next",
    );
    assert.equal(actionLine({ ...map(controls), phase: RUN_MAP_PHASE.ended }, []), "");
  });
});

describe("where a question was seen", () => {
  const surveyed: RunMap = {
    ...map([]),
    screens: [
      { top: 900, height: 800, reused: false },
      { top: 1670, height: 800, reused: true },
    ],
    settled: [{ from: 0, to: 900 }],
  };

  it("is the survey screen it lies on, numbered as the pictures are", () => {
    assert.deepEqual(seenAt(surveyed, 1000), { screen: 1 });
    assert.deepEqual(seenAt(surveyed, 2400), { screen: 2 });
  });

  it("is the screen it lies most inside of where two screens overlap", () => {
    assert.deepEqual(seenAt(surveyed, 1680), { screen: 1 });
    assert.deepEqual(seenAt(surveyed, 1690), { screen: 2 });
    assert.deepEqual(seenAt(surveyed, 1660), { screen: 1 });
  });

  it("is a settled part when no screen of the survey holds it, and nothing when neither does", () => {
    assert.deepEqual(seenAt(surveyed, 400), { settled: true });
    assert.equal(seenAt(surveyed, 2600), undefined);
  });

  it("goes with each question of the model's list", () => {
    const questions = questionsOf({
      ...surveyed,
      fields: [
        { label: "Visa sponsorship", y: 1100, state: "empty" },
        { label: "Race", y: 2300, state: "filled" },
        { label: "First name", y: 300, state: "filled" },
      ],
    });
    assert.deepEqual(
      questions.map((question) => [question.label, question.seen]),
      [
        ["Visa sponsorship", { screen: 1 }],
        ["Race", { screen: 2 }],
        ["First name", { settled: true }],
      ],
    );
  });
});
