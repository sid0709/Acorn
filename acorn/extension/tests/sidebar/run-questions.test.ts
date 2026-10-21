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
  it("are the page's fields top to bottom, with what each shows and what became of it", () => {
    const questions = questionsOf(
      map(
        [
          control("email", 200, { label: "Email", empty: false, value: "ada@example.com" }),
          control("first", 100, { label: "First name", empty: true, required: true }),
          control("phone", 300, { label: "Phone", empty: true }),
          control("next", 900, { kind: "button", label: "Next" }),
          control("country", 400, { kind: "select", label: "Country" }),
          control("ssn", 500, { label: "Tax number", empty: false, invalid: true }),
        ],
        [
          point("a1", "phone", RUN_POINT_STATE.current),
          point("a2", "country", RUN_POINT_STATE.pending),
        ],
      ),
    );
    assert.deepEqual(
      questions.map((question) => [question.label, question.status, question.value]),
      [
        ["First name", QUESTION_STATUS.open, undefined],
        ["Email", QUESTION_STATUS.answered, "ada@example.com"],
        ["Phone", QUESTION_STATUS.doing, undefined],
        ["Country", QUESTION_STATUS.next, undefined],
        ["Tax number", QUESTION_STATUS.problem, undefined],
      ],
      "a button asks nothing",
    );
    assert.deepEqual(questionTally(questions), { answered: 1, total: 5 });
    assert.deepEqual(
      questions.filter(needsYou).map((question) => question.label),
      ["First name", "Tax number"],
    );
  });

  it("joins radio buttons into the one question they answer, answered by the ticked one", () => {
    const [choice] = questionsOf(
      map([
        control("yes", 100, {
          kind: "check",
          label: "Yes",
          group: "radio:auth",
          question: "Authorized to work?",
          checked: true,
        }),
        control("no", 130, { kind: "check", label: "No", group: "radio:auth", checked: false }),
      ]),
    );
    assert.equal(choice?.kind, "choice");
    assert.equal(choice?.label, "Authorized to work?");
    assert.equal(choice?.value, "Yes");
    assert.equal(choice?.status, QUESTION_STATUS.answered);
    assert.deepEqual(choice?.controls, ["yes", "no"]);
    assert.deepEqual(choice?.box, { x: 100, y: 100, w: 300, h: 70 });
  });

  it("names a group the page did not name by its options, and a field by its kind", () => {
    const questions = questionsOf(
      map([
        control("a", 100, { kind: "check", label: "Day", group: "radiogroup:1", checked: false }),
        control("b", 130, { kind: "check", label: "Night", group: "radiogroup:1", checked: false }),
        control("c", 200, { kind: "select" }),
      ]),
    );
    assert.deepEqual(
      questions.map((question) => [question.label, question.named, question.status]),
      [
        ["Day / Night", true, QUESTION_STATUS.blank],
        ["Dropdown", false, QUESTION_STATUS.unknown],
      ],
    );
    assert.deepEqual(questionTally(questions), { answered: 0, total: 0 }, "neither counts");
  });

  it("takes a dropdown the page draws itself as answered once the run's action on it is done", () => {
    const [dropdown] = questionsOf(
      map(
        [control("c", 200, { kind: "select", label: "Country" })],
        [point("a1", "c", RUN_POINT_STATE.done)],
      ),
    );
    assert.equal(dropdown?.status, QUESTION_STATUS.answered);
  });

  it("believes the page over the plan: a field still empty after its action is not answered", () => {
    const [field] = questionsOf(
      map(
        [control("f", 200, { label: "City", empty: true })],
        [point("a1", "f", RUN_POINT_STATE.done)],
      ),
    );
    assert.equal(field?.status, QUESTION_STATUS.blank);
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
