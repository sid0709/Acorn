/**
 * How a run uses the page's control list (`control-marks.ts` says what for): it keeps the list current
 * while the run goes on, tells the agent the list and where the form moved with each look, answers the
 * executor's questions about the control a point was bound to, and waits for the page to go quiet instead
 * of for a fixed time. The run loop only wires these in.
 */

import {
  CONTROL_MARK_POLL_MS,
  marksForAgent,
  moved,
  scaleMoves,
  type ControlMark,
  type LayoutMove,
} from "./control-marks";
import { waitForQuiet, type ControlWatch } from "./control-watch";
import { PageMapKeeper } from "./page-map";
import { SurveyKeeper, type PlaceMarks } from "./survey";

import type { Cdp } from "./cdp";
import type { RunLog } from "../pipeline/run-log";
import type { AgentObservation } from "@acorn/shared/agent-contract";

/** The page's controls and the move of the form, as a look tells the agent: in the screenshot's pixels. */
export function marksOfLook(
  watch: ControlWatch,
  sent: ControlMark[],
  scale: number,
): Pick<AgentObservation, "marks" | "layout"> {
  const moves = watch.moves(sent);
  return {
    ...(sent.length > 0 ? { marks: marksForAgent(sent, scale) } : {}),
    ...(moves && moves.length > 0 ? { layout: scaleMoves(moves, scale) } : {}),
  };
}

/**
 * The list a look tells the agent of, which the form's moves are measured from once the answer is back. A
 * look that is a survey is what a plan measures its points on: a point bound to no control is placed from
 * its list when the page changes shape.
 */
export function noteLook(watch: ControlWatch, survey: unknown): ControlMark[] {
  const sent = watch.marks;
  if (survey) watch.survey(sent);
  return sent;
}

/** A move for the log, whole pixels. */
function roundedMove(move: LayoutMove): LayoutMove {
  return { from: Math.round(move.from), at: Math.round(move.at), dy: Math.round(move.dy) };
}

/**
 * Reads the control list while the run goes on: the survey is told where the form moved, the map of the page
 * draws the controls and the move, and a move of the form is logged once. Returns the function that stops the poll.
 */
export function startControlWatch(args: {
  tab: () => { cdp: Cdp } | null;
  surveying: () => boolean;
  watch: ControlWatch;
  surveys: SurveyKeeper;
  pages: PageMapKeeper;
  log: RunLog;
  emit: () => void;
}): () => void {
  let logged = "";
  const timer = setInterval(() => {
    const tab = args.tab();
    if (!tab || !args.surveying()) return;
    void args.watch.read(tab.cdp).then((changed) => {
      if (!changed) return;
      const moves = args.watch.moves();
      args.surveys.noteLayout(moves);
      args.pages.setControls(args.watch.marks);
      args.pages.setMoves(moves);
      const line = JSON.stringify(moves ?? []);
      if (moves && moves.length > 0 && line !== logged) {
        args.log.event("agent-layout", { moves: moves.map(roundedMove) });
      }
      logged = line;
      args.emit();
    });
  }, CONTROL_MARK_POLL_MS);
  return () => clearInterval(timer);
}

/**
 * Reads the list afresh and tells the survey where the form moved, before a look: the poll is a quarter of a
 * second behind, and the look must see what the last action did. A run that does not survey keeps no list.
 */
export async function syncControlLayout(
  surveyOn: boolean,
  cdp: Cdp,
  watch: ControlWatch,
  surveys: SurveyKeeper,
): Promise<void> {
  if (!surveyOn) return;
  await watch.read(cdp, { fresh: true });
  surveys.noteLayout(watch.moves());
}

/** How long the form's controls must stay where they are, after a résumé is attached, before the next click. */
export const FORM_QUIET_MS = 500;
/** The longest that wait lasts: a page that keeps moving is acted on anyway. */
export const FORM_SETTLE_MAX_MS = 4000;

/** What the executor asks of the control a point was bound to: the page answers, and what is not ordinary is logged. */
export function placeMarksFor(args: {
  tab: () => { cdp: Cdp };
  watch: ControlWatch;
  log: RunLog;
  sleep: (ms: number) => Promise<void>;
}): PlaceMarks {
  return {
    settle: async () => {
      const ms = await args.watch.settle(
        args.tab().cdp,
        args.sleep,
        FORM_QUIET_MS,
        FORM_SETTLE_MAX_MS,
      );
      args.log.event("agent-form-settle", { ms });
    },
    move: async (action, scale) => {
      if (!action.mark) return null;
      const move = await args.watch.move(args.tab().cdp, action.mark, scale);
      if (!move) {
        args.log.event("agent-mark", { id: action.id, control: action.mark.id, found: false });
      } else if (moved(move)) {
        args.log.event("agent-mark", {
          id: action.id,
          control: action.mark.id,
          dx: Math.round(move.dx),
          dy: Math.round(move.dy),
        });
      }
      return move;
    },
    holds: async (action, x, y) => {
      if (!action.mark) return false;
      const held = await args.watch.holds(args.tab().cdp, action.mark, x, y);
      if (!held) args.log.event("agent-mark", { id: action.id, control: action.mark.id, held });
      return held;
    },
    shift: (action, scale) => {
      if (action.scrollTo == null || action.y == null) return null;
      const shift = args.watch.shiftSince((action.scrollTo + action.y) / scale);
      if (shift !== 0)
        args.log.event("agent-mark", {
          id: action.id,
          shift: shift === null ? null : Math.round(shift),
        });
      return shift;
    },
  };
}

/**
 * The executor's pause after an action that changes the page: until the page has gone quiet, for at most the
 * fixed time it replaces. A page that cannot say (the tab is hidden, a navigation is under way) is waited
 * on for the whole time, and so is every page of a run that is not `quick` (fast fill).
 */
export function quietSettle(
  tab: () => { cdp: Cdp },
  sleep: (ms: number) => Promise<void>,
  quick: () => boolean,
): (ms: number, floorMs?: number) => Promise<void> {
  return async (ms, floorMs) => {
    if (quick() && (await waitForQuiet(tab().cdp, ms, floorMs))) return;
    await sleep(ms);
  };
}
