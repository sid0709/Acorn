import { useEffect, useRef, type ReactNode } from "react";
import { Badge, Glyph, List, ListItem, Spinner, Text } from "sid-ui";

import {
  QUESTION_STATUS,
  needsYou,
  type QuestionSeen,
  type QuestionStatus,
  type RunQuestion,
} from "./run-questions";

import type { RunFocus } from "./run-focus";

/** What a row says under its question when there is no answer to show. */
const SAID: Record<QuestionStatus, string> = {
  [QUESTION_STATUS.doing]: "Acorn is on it…",
  [QUESTION_STATUS.problem]: "Acorn couldn’t fill this",
  [QUESTION_STATUS.answered]: "Answered",
  [QUESTION_STATUS.next]: "Up next",
  [QUESTION_STATUS.open]: "Needs an answer",
  [QUESTION_STATUS.blank]: "Optional · left empty",
  [QUESTION_STATUS.unknown]: "Not read from the page",
};
/** Said of a question the page itself flags as wrong. */
const FLAGGED = "The page flags this answer";

/** The line under a question: what it shows, and why it is a problem when it is one. */
function describe(question: RunQuestion): string {
  if (question.status === QUESTION_STATUS.problem) {
    const why = question.flagged ? FLAGGED : SAID[QUESTION_STATUS.problem];
    return question.value ? `${question.value} · ${why}` : why;
  }
  if (question.value && question.status !== QUESTION_STATUS.blank) return question.value;
  return SAID[question.status];
}

/** A question's mark: a tick answered, a spinner being filled, "!" flagged, a ring to do, a dash left empty. */
function QuestionMark({ status }: { status: QuestionStatus }) {
  return (
    <span className="acorn-qmark" data-status={status} aria-hidden="true">
      {status === QUESTION_STATUS.doing ? <Spinner size="sm" shade="inherit" /> : null}
      {status === QUESTION_STATUS.answered ? <Glyph name="check" /> : null}
      {status === QUESTION_STATUS.blank ? <Glyph name="minus" /> : null}
      {status === QUESTION_STATUS.problem ? "!" : null}
    </span>
  );
}

/**
 * Where the model saw a question: the survey screen it lies on (the number on the pictures beside the map,
 * and on the screenshot the model was shown), or a part the model settled.
 */
function SeenBadge({ seen }: { seen: QuestionSeen }) {
  if ("settled" in seen) {
    return (
      <Badge
        variant="blue"
        icon={<Glyph name="lock" />}
        label="Settled"
        aria-label="In a part of the page the model settled"
      />
    );
  }
  return (
    <Badge
      variant="neutral"
      icon={<Glyph name="image" />}
      label={`Screen ${seen.screen}`}
      aria-label={`On screen ${seen.screen} of the model's last look`}
    />
  );
}

/** What a question's state asks of the person, when it asks anything: left blank, theirs, or not taken. */
function stateBadge(question: RunQuestion): ReactNode {
  if (question.flagged) {
    return <Badge variant="warning" icon={<Glyph name="user" />} label="Needs you" />;
  }
  if (question.status === QUESTION_STATUS.problem) {
    return <Badge variant="error" icon={<Glyph name="alert" />} label="Didn’t take" />;
  }
  if (question.status === QUESTION_STATUS.blank)
    return <Badge variant="neutral" label="Optional" />;
  return null;
}

/** The badges at a row's end: what its state asks, then where it was seen. */
function RowBadges({ question }: { question: RunQuestion }) {
  const state = stateBadge(question);
  if (!question.seen && !state) return null;
  return (
    <span className="acorn-question-badges">
      {state}
      {question.seen ? <SeenBadge seen={question.seen} /> : null}
    </span>
  );
}

interface RunQuestionsProps {
  questions: RunQuestion[];
  /** No run works on the page any more: what still needs the person comes first. */
  ended: boolean;
  focus: RunFocus | null;
  onFocusChange: (focus: RunFocus | null) => void;
  /** Shows a question's field on the page; unset while a run works there. */
  onShow?: (question: RunQuestion) => void;
}

/**
 * The questions of the page beside its map, top to bottom: what each shows and what became of it. While a
 * run works, the one it fills stays in view; once it stopped, what still needs the person comes first, and
 * a row shows its field on the page. Pointing at a row lights its marks on the map.
 */
export function RunQuestions(props: RunQuestionsProps) {
  const { questions, ended, focus, onFocusChange, onShow } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const inside = useRef(false);
  const lit = focus?.kind === "question" ? focus.id : undefined;
  const doing = questions.find((question) => question.status === QUESTION_STATUS.doing)?.id;

  // The lit row, or else the one being filled, is brought into the list's view (never the panel's scroll),
  // unless the pointer is in the list: then the person is reading it.
  useEffect(() => {
    const box = scroller.current;
    const target = lit ?? (inside.current ? undefined : doing);
    if (!box || !target) return;
    const row = box.querySelector(`[data-question="${CSS.escape(target)}"]`);
    if (!row) return;
    const frame = box.getBoundingClientRect();
    const place = row.getBoundingClientRect();
    const top = place.top - frame.top + box.scrollTop;
    const bottom = top + place.height;
    if (top < box.scrollTop) box.scrollTo({ top, behavior: "smooth" });
    else if (bottom > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: bottom - box.clientHeight, behavior: "smooth" });
    }
  }, [lit, doing]);

  const row = (question: RunQuestion) => {
    const focusOn: RunFocus = { kind: "question", id: question.id };
    return (
      <ListItem
        key={question.id}
        className="acorn-question"
        data-question={question.id}
        data-named={question.named ? undefined : "false"}
        label={question.label}
        description={describe(question)}
        startContent={<QuestionMark status={question.status} />}
        endContent={<RowBadges question={question} />}
        isSelected={lit === question.id}
        onClick={() => {
          if (onShow) onShow(question);
          else onFocusChange(lit === question.id ? null : focusOn);
        }}
        onMouseEnter={() => onFocusChange(focusOn)}
        onFocus={() => onFocusChange(focusOn)}
      />
    );
  };
  const waiting = ended ? questions.filter(needsYou) : [];
  const rest = ended ? questions.filter((question) => !needsYou(question)) : questions;

  return (
    <div
      ref={scroller}
      className="acorn-questions"
      data-ended={ended ? "true" : undefined}
      onMouseEnter={() => {
        inside.current = true;
      }}
      onMouseLeave={() => {
        inside.current = false;
        if (focus?.kind === "question") onFocusChange(null);
      }}
    >
      {questions.length === 0 ? (
        <Text type="supporting" color="secondary">
          No questions read on this page yet.
        </Text>
      ) : null}
      {waiting.length > 0 ? (
        <List
          density="compact"
          header={
            <Text type="supporting" weight="semibold">
              Needs you
            </Text>
          }
        >
          {waiting.map(row)}
        </List>
      ) : null}
      {rest.length > 0 ? (
        <List
          density="compact"
          header={
            waiting.length > 0 ? (
              <Text type="supporting" weight="semibold">
                The rest
              </Text>
            ) : undefined
          }
        >
          {rest.map(row)}
        </List>
      ) : null}
    </div>
  );
}
