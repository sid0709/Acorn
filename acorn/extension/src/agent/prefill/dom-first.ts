/**
 * The DOM-first loop after a first draft has been typed (docs 19.4m). It reviews the page, and when the
 * page is clean it presses the control that continues the application, all without the driving model:
 *
 *   review  the page says what is left (required fields empty, errors, fills that did not take); when
 *           nothing is, the server's decision model reads the screenshot for what the page cannot say
 *   advance the page's own buttons are listed and the decision model picks the one that continues
 *   hand over  anything else (something left, an unsure pick, a page that did not move on) goes to the
 *           driving model as a note that says exactly what is left
 *
 * A check only the person can pass ends the run asking for them; a run that stops before submitting
 * ends where the control that sends the application was found.
 */

import {
  ADVANCE_ACTION,
  REVIEW_VERDICT,
  type AgentStep,
  type AgentSurveyScreen,
  type AgentTrace,
  type AgentUsage,
  type AgentViewport,
} from "@acorn/shared/agent-contract";

import { AgentApiError, requestAdvance, requestReview } from "../client";
import { watchInputEffects } from "../input-settle";

import { act, pointOf, type FillContext } from "./fill";
import { askFrame, listFrames, type FrameInfo } from "./frames";
import { PREFILL_MESSAGE, type FrameCandidates, type FrameReview } from "./messages";
import {
  ADVANCE_LOAD_MAX_MS,
  ADVANCE_LOAD_POLL_MS,
  ADVANCE_NAVIGATION_APPEAR_MS,
  ADVANCE_NAVIGATION_BEAT_MS,
  ADVANCE_OVERLAY_LABEL,
  ADVANCE_STUCK_TRIES,
  ADVANCE_UNSURE_NOTE,
  DOM_OPTIMISTIC_ADVANCE,
  REVIEW_BLOCKED_RECHECK_MS,
  REVIEW_LOADING_WAIT_MS,
  REVIEW_LOADING_WAITS,
  REVIEW_OVERLAY_LABEL,
} from "./settings";

import type { ExecutorContext } from "../executor";
import type { AgentAdvanceCandidate, AgentReviewFindings } from "@acorn/shared/agent-contract";

/** What the loop did at a look. */
export type DomFirstOutcome =
  /** Nothing to do here: the page is not a form, the loop is off, or a call failed. The driving model looks. */
  | { kind: "skip" }
  /** The driving model looks, with these notes. */
  | { kind: "notes"; notes: string[] }
  /** A control was pressed: look at the page again, with no driving-model look. */
  | { kind: "advanced" }
  /** The page is still changing: it was waited for; look again. */
  | { kind: "wait" }
  /** The server ended the run (only the person can go on, or it is ready to submit). */
  | { kind: "step"; step: AgentStep };

export interface DomFirstDeps {
  agentUrl: string;
  sessionId: () => string;
  signal: AbortSignal;
  tabId: () => number;
  /** The run's executor with points in the tab's own CSS pixels. */
  executor: () => ExecutorContext;
  sleep: (ms: number) => Promise<void>;
  checkStopped: () => void;
  log: (event: string, fields: Record<string, unknown>) => void;
  recordTrace: (trace: AgentTrace | undefined, screenshot?: string) => void;
  setLabel: (label: string) => void;
  /** What a call cost, and how long the step took, for the run's totals. */
  onCall: (kind: "review" | "advance", usage: AgentUsage, ms: number) => void;
}

/** The page as a look saw it. */
export interface DomLook {
  url: string;
  title: string;
  screenshot: string;
  viewport: AgentViewport;
  /** Labels of fills the pass made that did not take. */
  failed: string[];
  /** Takes the whole page as screenshots from top to bottom; null when it fits one screen. Called only when needed. */
  survey: () => Promise<AgentSurveyScreen[] | null>;
}

interface FrameControl {
  frameId: number;
  nodeId: number;
  candidate: AgentAdvanceCandidate;
}

/** Whether the page's own state found anything wrong. */
function hasProblems(findings: AgentReviewFindings): boolean {
  return [findings.empty, findings.errors, findings.failed, findings.blocked].some(
    (list) => (list?.length ?? 0) > 0,
  );
}

export class DomFirst {
  /** The application was sent, or the screen says so: the driving model confirms it from here on. */
  private submitted = false;
  private loadingWaits = 0;
  /** What the page looked like when a control was last pressed, and how many times it was pressed at that. */
  private lastAdvanceKey = "";
  private lastAdvanceText = "";
  private tries = 0;
  /** A page the control could not move on: left to the driving model until it changes. */
  private stuckKey = "";
  /** A clean page where no control was chosen with enough certainty: not reviewed again until it changes. */
  private unsureKey = "";
  private pageKey = "";
  /** The page as it was when a control was last pressed: the same page at the next look means the press did not move it. */
  private pressedPageKey = "";

  constructor(private readonly deps: DomFirstDeps) {}

  /** Whether the loop has handed the rest of the run to the driving model. */
  get finished(): boolean {
    return this.submitted;
  }

  async afterLook(look: DomLook): Promise<DomFirstOutcome> {
    if (this.submitted) return { kind: "skip" };
    const frames = await listFrames(this.deps.tabId());
    let findings = await this.readFindings(frames, look.failed);
    if (!findings) return { kind: "skip" };
    // A disabled continue control right after a press is usually the page submitting: it is reported
    // only if it is still disabled after a beat (a page that moved on has other things to say).
    if ((findings.blocked?.length ?? 0) > 0) {
      await this.deps.sleep(REVIEW_BLOCKED_RECHECK_MS);
      findings = await this.readFindings(await listFrames(this.deps.tabId()), look.failed);
      if (!findings) return { kind: "skip" };
    }
    const hasFields = findings.fields > 0;

    // The same page, already reviewed clean with no control to press: the driving model has been told, and
    // another review would say the same. It is looked at again once something on the page changes.
    this.pageKey = [
      look.url,
      look.title,
      findings.fields,
      ...(findings.empty ?? []),
      ...(findings.errors ?? []),
      ...(findings.blocked ?? []),
    ].join("|");
    if (this.pageKey === this.unsureKey) return { kind: "skip" };

    // Forward first: a page whose own state is clean, or that has no fields at all (a review page, a
    // job description), goes straight to its continue control with no screens taken and no review. The
    // page's own validation answers if something is missing, and the screens are read only when a press
    // did not move the page.
    if (DOM_OPTIMISTIC_ADVANCE && this.pageKey !== this.pressedPageKey && !hasProblems(findings)) {
      const controls = await this.listControls(frames);
      if (controls.length > 0) return this.advance(frames, look, findings, [], null, controls);
    }

    this.deps.setLabel(REVIEW_OVERLAY_LABEL);
    const began = Date.now();
    // What the page says of itself settles it when there is anything wrong, so no screens are taken then.
    // Otherwise the decision model is the judge, and it reads the whole page, not the part on screen. A page
    // with no fields is read as the one screen it shows: there is nothing on it to check below.
    const survey =
      hasProblems(findings) || !hasFields ? null : await look.survey().catch(() => null);
    let review;
    try {
      review = await requestReview(
        this.deps.agentUrl,
        this.deps.sessionId(),
        {
          url: look.url,
          title: look.title,
          screenshot: look.screenshot,
          viewport: look.viewport,
          dom: findings,
          ...(survey ? { survey } : {}),
        },
        this.deps.signal,
      );
    } catch (err) {
      return this.failed("review", err);
    }
    this.deps.onCall("review", review.usage, Date.now() - began);
    this.deps.recordTrace(review.trace, look.screenshot);
    this.deps.log("agent-dom:review", {
      verdict: review.verdict,
      problems: review.problems?.length ?? 0,
      empty: findings.empty?.length ?? 0,
      errors: findings.errors?.length ?? 0,
      failed: findings.failed?.length ?? 0,
      ms: Date.now() - began,
    });

    const notes = review.note ? [review.note] : [];
    if (review.verdict !== REVIEW_VERDICT.loading) this.loadingWaits = 0;
    switch (review.verdict) {
      case REVIEW_VERDICT.human:
        return review.step ? { kind: "step", step: review.step } : { kind: "notes", notes };
      case REVIEW_VERDICT.loading:
        if (this.loadingWaits >= REVIEW_LOADING_WAITS) return { kind: "skip" };
        this.loadingWaits += 1;
        await this.deps.sleep(REVIEW_LOADING_WAIT_MS);
        return { kind: "wait" };
      case REVIEW_VERDICT.sent:
        this.submitted = true;
        return { kind: "notes", notes };
      case REVIEW_VERDICT.clean:
        return this.advance(frames, look, findings, notes, survey);
      case REVIEW_VERDICT.fix:
        return { kind: "notes", notes };
      default:
        return { kind: "skip" };
    }
  }

  private failed(what: string, err: unknown): DomFirstOutcome {
    this.deps.checkStopped();
    if (this.deps.signal.aborted) throw err;
    this.deps.log(`agent-dom:${what}-error`, {
      message: err instanceof Error ? err.message : String(err),
      code: err instanceof AgentApiError ? err.code : "",
    });
    return { kind: "skip" };
  }

  /** What every frame of the tab says of itself, with the pass's failures added. Null when no frame shows a field. */
  private async readFindings(
    frames: FrameInfo[],
    failed: string[],
  ): Promise<AgentReviewFindings | null> {
    const tabId = this.deps.tabId();
    const answers = await Promise.all(
      frames.map((frame) =>
        askFrame<FrameReview>(tabId, frame.frameId, { type: PREFILL_MESSAGE.review }),
      ),
    );
    const findings: Required<AgentReviewFindings> = {
      fields: 0,
      empty: [],
      errors: [],
      failed,
      blocked: [],
    };
    for (const answer of answers) {
      if (!answer?.ok) continue;
      findings.fields += answer.fields;
      for (const label of answer.empty)
        if (!findings.empty.includes(label)) findings.empty.push(label);
      for (const text of answer.errors)
        if (!findings.errors.includes(text)) findings.errors.push(text);
      for (const text of answer.blocked)
        if (!findings.blocked.includes(text)) findings.blocked.push(text);
    }
    return answers.some((answer) => answer?.ok) ? findings : null;
  }

  /** The controls of every frame that could be pressed, numbered across frames. */
  private async listControls(frames: FrameInfo[]): Promise<FrameControl[]> {
    const tabId = this.deps.tabId();
    const answers = await Promise.all(
      frames.map(async (frame) => ({
        frameId: frame.frameId,
        answer: await askFrame<FrameCandidates>(tabId, frame.frameId, {
          type: PREFILL_MESSAGE.candidates,
        }),
      })),
    );
    const controls: FrameControl[] = [];
    for (const { frameId, answer } of answers) {
      if (!answer?.ok) continue;
      for (const found of answer.candidates) {
        controls.push({
          frameId,
          nodeId: found.nodeId,
          candidate: {
            ref: controls.length,
            text: found.text,
            kind: found.kind,
            inForm: found.inForm,
          },
        });
      }
    }
    return controls;
  }

  private async advance(
    frames: FrameInfo[],
    look: DomLook,
    findings: AgentReviewFindings,
    notes: string[],
    survey: AgentSurveyScreen[] | null,
    listed?: FrameControl[],
  ): Promise<DomFirstOutcome> {
    const controls = listed ?? (await this.listControls(frames));
    const key = [
      look.url,
      look.title,
      findings.fields,
      controls.map((c) => c.candidate.text).join(","),
    ].join("|");
    if (controls.length === 0 || key === this.stuckKey) return { kind: "notes", notes };
    if (key === this.lastAdvanceKey) {
      this.tries += 1;
      if (this.tries >= ADVANCE_STUCK_TRIES) {
        this.stuckKey = key;
        this.deps.log("agent-dom:stuck", { tries: this.tries });
        return {
          kind: "notes",
          notes: [
            `Acorn pressed "${this.lastAdvanceText}" ${this.tries} times and the page did not move on. Look at the page and find out why: a message, a field it wants, or a control that is not the one that continues.`,
          ],
        };
      }
    } else {
      this.tries = 0;
    }

    const began = Date.now();
    let advance;
    try {
      advance = await requestAdvance(
        this.deps.agentUrl,
        this.deps.sessionId(),
        {
          url: look.url,
          title: look.title,
          screenshot: look.screenshot,
          candidates: controls.map((control) => control.candidate),
          viewport: look.viewport,
          ...(survey ? { survey } : {}),
        },
        this.deps.signal,
      );
    } catch (err) {
      return this.failed("advance", err);
    }
    this.deps.onCall("advance", advance.usage, Date.now() - began);
    this.deps.recordTrace(advance.trace, look.screenshot);
    this.deps.log("agent-dom:advance", {
      action: advance.action,
      submit: Boolean(advance.submit),
      controls: controls.length,
      sure: advance.sure,
      none: advance.none,
      control: advance.text,
      ms: Date.now() - began,
    });
    if (advance.action === ADVANCE_ACTION.readyToSubmit && advance.step) {
      return { kind: "step", step: advance.step };
    }
    const chosen = controls.find((control) => control.candidate.ref === advance.ref);
    if (advance.action !== ADVANCE_ACTION.click || !chosen) {
      this.unsureKey = this.pageKey;
      return { kind: "notes", notes: [...notes, ADVANCE_UNSURE_NOTE] };
    }

    this.deps.setLabel(ADVANCE_OVERLAY_LABEL);
    const error = await this.press(frames, chosen);
    this.deps.log("agent-dom:pressed", {
      submit: Boolean(advance.submit),
      ok: error == null,
      ms: Date.now() - began,
    });
    if (error) {
      return {
        kind: "notes",
        notes: [
          `Acorn tried to press "${chosen.candidate.text}" to continue and could not: ${error}`,
          ...notes,
        ],
      };
    }
    this.lastAdvanceKey = key;
    this.lastAdvanceText = chosen.candidate.text;
    this.pressedPageKey = this.pageKey;
    // The application is on its way: the driving model confirms that it was received, as ever.
    if (advance.submit) this.submitted = true;
    return { kind: "advanced" };
  }

  /** Presses a control with the run's real mouse, and waits for what it sets off. Null, or why it could not. */
  private async press(frames: FrameInfo[], control: FrameControl): Promise<string | null> {
    const ctx: FillContext = {
      tabId: this.deps.tabId(),
      frames,
      executor: this.deps.executor(),
      sleep: this.deps.sleep,
      checkStopped: this.deps.checkStopped,
    };
    const point = await pointOf(ctx, control.frameId, control.nodeId);
    if (typeof point === "string") return point;
    const before = (await chrome.tabs.get(ctx.tabId).catch(() => null))?.url ?? "";
    const effects = await watchInputEffects(ctx.executor.cdp);
    const error = await act(ctx, [{ id: "d1", kind: "click", x: point.x, y: point.y }]);
    await effects.settle(this.deps.sleep);
    await this.waitForLoad(before);
    return error;
  }

  /**
   * The page the click went to, given the time it needs to finish loading. A click that navigates is
   * waited for from the moment the address changes or the tab says it is loading until it says it is
   * done; one that starts nothing within ADVANCE_NAVIGATION_APPEAR_MS stayed on the page (a step the page
   * draws itself), which its own requests have already settled.
   */
  private async waitForLoad(before: string): Promise<void> {
    await this.deps.sleep(ADVANCE_NAVIGATION_BEAT_MS);
    const began = Date.now();
    const until = began + ADVANCE_LOAD_MAX_MS;
    let navigating = false;
    while (Date.now() < until) {
      const tab = await chrome.tabs.get(this.deps.tabId()).catch(() => null);
      if (!tab) return;
      if (tab.url !== before || tab.status === "loading") navigating = true;
      if (navigating && tab.status === "complete") return;
      if (!navigating && Date.now() - began > ADVANCE_NAVIGATION_APPEAR_MS) return;
      await this.deps.sleep(ADVANCE_LOAD_POLL_MS);
    }
  }
}
