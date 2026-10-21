import { useRef, useState } from "react";
import { Text, VStack } from "sid-ui";

import { PageMap } from "./PageMap";
import { RunMapKey } from "./RunMapKey";
import { RunQuestions } from "./RunQuestions";
import { RunShots } from "./RunShots";
import { useBoxSize } from "./use-box-size";
import { useRunShots } from "./use-run-shots";

import type { RunFocus } from "./run-focus";
import type { RunQuestion } from "./run-questions";
import type { ShowTarget } from "./show-on-page";
import type { RunMap } from "@acorn/shared/run-types";

interface RunBoardProps {
  map: RunMap;
  questions: RunQuestion[];
  /** The run the map is of: the filmstrip shows only its pictures. */
  runId: string;
  tabId: number | null;
  /** A run works on the page: it owns the scroll, so nothing is shown on the page from here. */
  working: boolean;
  onShow: (target: ShowTarget) => void;
}

/**
 * The run's board in the Now card: the map of the page beside the list of its questions, the pictures the
 * model last saw, and the key to the map. The three light up together: pointing at a question, at its marks,
 * or at a picture shows the same thing in all of them.
 */
export function RunBoard({ map, questions, runId, tabId, working, onShow }: RunBoardProps) {
  const [focus, setFocus] = useState<RunFocus | null>(null);
  const stored = useRunShots(tabId);
  const shots = stored?.runId === runId ? stored.shots : [];
  const frame = useRef<HTMLDivElement>(null);
  const size = useBoxSize(frame);
  const show = working ? undefined : onShow;

  return (
    <VStack gap={3}>
      <div className="acorn-board">
        <div ref={frame} className="acorn-board-map">
          {size.width > 0 && size.height > 0 ? (
            <PageMap
              map={map}
              questions={questions}
              shots={shots}
              focus={focus}
              ended={!working}
              width={size.width}
              height={size.height}
              onFocus={setFocus}
              onPick={show}
            />
          ) : null}
        </div>
        <RunQuestions
          questions={questions}
          ended={!working}
          focus={focus}
          onFocusChange={setFocus}
          onShow={
            show
              ? (question) => show({ control: question.controls[0], y: question.box.y })
              : undefined
          }
        />
      </div>
      {shots.length > 0 ? (
        <RunShots shots={shots} points={map.points} focus={focus} onFocusChange={setFocus} />
      ) : null}
      <RunMapKey />
    </VStack>
  );
}

/** The board before the tab's first run: an empty sheet, and what will appear on it. */
export function EmptyBoard() {
  return (
    <div className="acorn-board acorn-board-empty">
      <div className="acorn-board-map">
        <div className="acorn-board-sheet" aria-hidden="true" />
      </div>
      <VStack gap={1} justify="center">
        <Text type="supporting" weight="semibold">
          Page map
        </Text>
        <Text type="supporting">
          Press Run. Acorn draws this page here and ticks off each question as it fills it.
        </Text>
      </VStack>
    </div>
  );
}
