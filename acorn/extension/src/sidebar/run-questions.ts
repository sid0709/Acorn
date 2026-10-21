/**
 * The questions of the form a run is on, as the Now card lists them beside the map: each field of the page
 * (radio buttons, and check boxes of one name, together as one question), what it shows, and what became
 * of it, from what the page says of its controls and what the plan's points did to them. Pure, so the card,
 * the map and the tests read the same answer.
 */

import {
  RUN_MAP_PHASE,
  RUN_POINT_STATE,
  type RunMap,
  type RunMapControl,
  type RunMapField,
  type RunMapPhase,
  type RunMapPoint,
  type RunPointState,
} from "@acorn/shared/run-types";

/** What became of a question, as the list and the map show it. */
export const QUESTION_STATUS = {
  /** The run is acting on it now. */
  doing: "doing",
  /** The page says it is wrong, or the run's action on it failed. */
  problem: "problem",
  answered: "answered",
  /** The plan being carried out acts on it. */
  next: "next",
  /** Required, and not answered. */
  open: "open",
  /** Optional, and left empty. */
  blank: "blank",
  /** The page does not say (a dropdown it draws itself), and the run has not acted on it. */
  unknown: "unknown",
} as const;
export type QuestionStatus = (typeof QUESTION_STATUS)[keyof typeof QUESTION_STATUS];

/** What a question is answered with: a field of one kind, or a choice among radio buttons or check boxes. */
export type QuestionKind = "input" | "select" | "check" | "file" | "choice";

/** The kinds of control that ask something; a button asks nothing. */
const FIELD_KINDS: ReadonlySet<string> = new Set(["input", "select", "check", "file"]);

/** What a question the page does not name is called, by its kind: in the list, and in a sentence. */
const UNNAMED: Record<QuestionKind, { label: string; phrase: string }> = {
  input: { label: "Text box", phrase: "a text box" },
  select: { label: "Dropdown", phrase: "a dropdown" },
  check: { label: "Check box", phrase: "a check box" },
  file: { label: "File", phrase: "a file field" },
  choice: { label: "Choice", phrase: "a choice" },
};

/** What the run is doing to a question of each kind, in the card's line. */
const VERB: Record<QuestionKind, string> = {
  input: "Filling",
  select: "Choosing",
  check: "Ticking",
  file: "Uploading to",
  choice: "Answering",
};

/** What the run is doing while it is not acting on a question, in the card's line; nothing once it ended. */
export const PHASE_LINE: Record<RunMapPhase, string> = {
  [RUN_MAP_PHASE.starting]: "Starting",
  [RUN_MAP_PHASE.looking]: "Looking at the page",
  [RUN_MAP_PHASE.thinking]: "Asking the model what to do next",
  [RUN_MAP_PHASE.acting]: "Working on the page",
  [RUN_MAP_PHASE.waiting]: "Waiting for you",
  [RUN_MAP_PHASE.ended]: "",
};

/** The value shown for a check box that stands alone and is ticked. */
const TICKED = "Yes";

/** One question of the form. */
export interface RunQuestion {
  /** The page's id of its control, or of its group. */
  id: string;
  kind: QuestionKind;
  /** What the page calls it, or what kind of field it is when the page does not say (`named` false). */
  label: string;
  named: boolean;
  /** What it shows now: the typed answer, the chosen options, the file. */
  value?: string;
  required: boolean;
  status: QuestionStatus;
  /** The page says the answer is wrong (as opposed to the run's action on it having failed). */
  flagged: boolean;
  /** The ids of its controls, in the page's order. */
  controls: string[];
  /** Its place on the page (CSS pixels), round all its controls. */
  box: { x: number; y: number; w: number; h: number };
}

function boxOf(controls: RunMapControl[]): RunQuestion["box"] {
  const left = Math.min(...controls.map((control) => control.x));
  const top = Math.min(...controls.map((control) => control.y));
  const right = Math.max(...controls.map((control) => control.x + control.w));
  const bottom = Math.max(...controls.map((control) => control.y + control.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** The points of the plan by the control they act on. */
function pointsByControl(points: RunMapPoint[]): Map<string, RunMapPoint[]> {
  const out = new Map<string, RunMapPoint[]>();
  for (const point of points) {
    if (!point.control) continue;
    out.set(point.control, [...(out.get(point.control) ?? []), point]);
  }
  return out;
}

function questionOf(
  id: string,
  members: RunMapControl[],
  points: Map<string, RunMapPoint[]>,
): RunQuestion {
  const [first] = members;
  const grouped = Boolean(first.group);
  const kind: QuestionKind = grouped ? "choice" : (first.kind as QuestionKind);
  const acted = members.flatMap((control) => points.get(control.id) ?? []);
  const was = (state: RunPointState) => acted.some((point) => point.state === state);
  const ticks = members.filter((control) => control.checked !== undefined);
  const ticked = ticks.filter((control) => control.checked === true);
  const said = grouped
    ? first.question ||
      members
        .map((control) => control.label ?? "")
        .filter(Boolean)
        .join(" / ")
    : (first.label ?? "");
  let value: string | undefined;
  if (grouped)
    value = ticked
      .map((control) => control.label ?? "")
      .filter(Boolean)
      .join(", ");
  else if (kind === "check") value = first.checked ? TICKED : undefined;
  else value = first.value;
  // What the page's own list says of a control's state is not read: the pictures are the source of truth
  // (questionsOfFields). Before the model has read the page, a question's status is only what the plan is
  // doing to it.
  const required = members.some((control) => control.required === true);
  let status: QuestionStatus = QUESTION_STATUS.unknown;
  if (was(RUN_POINT_STATE.current)) status = QUESTION_STATUS.doing;
  else if (was(RUN_POINT_STATE.failed)) status = QUESTION_STATUS.problem;
  else if (was(RUN_POINT_STATE.pending)) status = QUESTION_STATUS.next;
  return {
    id,
    kind,
    label: said || UNNAMED[kind].label,
    named: Boolean(said),
    ...(value ? { value } : {}),
    required,
    status,
    flagged: false,
    controls: members.map((control) => control.id),
    box: boxOf(members),
  };
}

/** How tall a question of the model's list is drawn on the map (CSS pixels): a row of a form. */
const FIELD_ROW_PX = 28;

/** What a field's state, as the model read it, is as a question's status. */
const FIELD_STATUS: Record<RunMapField["state"], QuestionStatus> = {
  filled: QUESTION_STATUS.answered,
  empty: QUESTION_STATUS.open,
  needs_person: QUESTION_STATUS.problem,
};

/**
 * The questions as the model read them from the pictures: the to-do list once a survey has been answered.
 * Each is placed by the row the model gave; a plan's point on that row says the run is acting on it.
 */
function questionsOfFields(map: RunMap, fields: RunMapField[]): RunQuestion[] {
  const controlsNear = (y: number) =>
    map.controls
      .filter(
        (control) =>
          FIELD_KINDS.has(control.kind) && Math.abs(control.y + control.h / 2 - y) <= FIELD_ROW_PX,
      )
      .map((control) => control.id);
  return fields.map((field, i) => {
    const controls = controlsNear(field.y);
    const acted = map.points.filter((point) => point.control && controls.includes(point.control));
    const was = (state: RunPointState) => acted.some((point) => point.state === state);
    let status = FIELD_STATUS[field.state];
    if (was(RUN_POINT_STATE.current)) status = QUESTION_STATUS.doing;
    else if (was(RUN_POINT_STATE.failed)) status = QUESTION_STATUS.problem;
    else if (status !== QUESTION_STATUS.answered && was(RUN_POINT_STATE.pending))
      status = QUESTION_STATUS.next;
    return {
      id: `field:${i}`,
      kind: "input",
      label: field.label,
      named: true,
      required: field.state !== "filled",
      status,
      flagged: field.state === "needs_person",
      controls,
      box: { x: 0, y: field.y - FIELD_ROW_PX / 2, w: map.pageWidth, h: FIELD_ROW_PX },
    };
  });
}

/**
 * The questions of the page, top to bottom and left to right: the model's own list once it has read the
 * page, else the page's controls, which say where things are but not whether they are answered.
 */
export function questionsOf(map: RunMap): RunQuestion[] {
  if (map.fields && map.fields.length > 0) return questionsOfFields(map, map.fields);
  const points = pointsByControl(map.points);
  const groups = new Map<string, RunMapControl[]>();
  for (const control of map.controls) {
    if (!FIELD_KINDS.has(control.kind)) continue;
    const key = control.group ? `group:${control.group}` : control.id;
    groups.set(key, [...(groups.get(key) ?? []), control]);
  }
  return [...groups.entries()]
    .map(([id, members]) => questionOf(id, members, points))
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

/**
 * How many questions are answered, of those that count: what is required, answered, wrong or acted on. An
 * optional field left empty, or one the page says nothing of, is not counted against the run.
 */
export function questionTally(questions: RunQuestion[]): { answered: number; total: number } {
  const counted = questions.filter(
    (question) =>
      question.status !== QUESTION_STATUS.blank && question.status !== QUESTION_STATUS.unknown,
  );
  return {
    answered: counted.filter((question) => question.status === QUESTION_STATUS.answered).length,
    total: counted.length,
  };
}

/** Whether a question waits on the person once the run stopped: it is wrong, or required and empty. */
export function needsYou(question: RunQuestion): boolean {
  return question.status === QUESTION_STATUS.problem || question.status === QUESTION_STATUS.open;
}

/** What a question is, in a sentence: its name in quotes, or what kind of field it is. */
function named(question: RunQuestion): string {
  return question.named ? `“${question.label}”` : UNNAMED[question.kind].phrase;
}

/** What the run is doing now, in a line: the question it acts on, else what it is busy with. */
export function actionLine(map: RunMap, questions: RunQuestion[]): string {
  if (map.phase !== RUN_MAP_PHASE.acting) return PHASE_LINE[map.phase];
  const point = map.points.find((one) => one.state === RUN_POINT_STATE.current);
  if (!point) return PHASE_LINE[RUN_MAP_PHASE.acting];
  const control = point.control;
  const question = control ? questions.find((one) => one.controls.includes(control)) : undefined;
  if (point.kind === "upload")
    return question ? `Uploading to ${named(question)}` : "Uploading a file";
  if (question) return `${VERB[question.kind]} ${named(question)}`;
  const pressed = control ? map.controls.find((one) => one.id === control) : undefined;
  if (pressed?.kind === "button" && pressed.label) return `Pressing “${pressed.label}”`;
  return "Clicking on the page";
}
