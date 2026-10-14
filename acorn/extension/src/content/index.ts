import { traceFromPage } from "../debug-trace";
import { MSG, PLAN_STEP_PAGE_TIMEOUT_MS, type PlanStepPayload } from "../types";

import { holdsAcornIds } from "./acorn-id";
import { executeActions, getElementContent } from "./action-runner";
import { fillLeftoverComboboxes } from "./agents/leftover-combobox";
import { waitForDomQuiet } from "./agents/wait";
import { collectChoiceItems, type ChoiceBatchStep } from "./choice-batch";
import { CLICK_AFTER_REPLY_MS, prepareControlClick } from "./click-control";
import { comboSnapshot } from "./debug-snapshot";
import { serializeDom } from "./dom-serializer";
import { repairDrift } from "./drift-repair";
import { resolveElementByNodeId } from "./element-resolver";
import { pageWantsAnswer, scanFieldIssues } from "./field-errors";
import {
  MIN_CHILD_FORM_CONTROLS,
  MIN_PAGE_FIELDS,
  formControlScore,
  isAcornDomFrame,
  waitForFormSurface,
} from "./form-frame";
import { claimOwnDocument } from "./frame-reach";
import { clearHighlight, highlightElement } from "./highlighter";
import { pageFieldScore } from "./page-fields";
import { probePage } from "./page-probe";
import { pageTimeout } from "./page-timer";
import { readFormFields } from "./pending-fields";
import { runPlanStep } from "./plan-step-runner";
import { endScope, readScope, scopeState, scopeTest, takeCensus } from "./scope";
import { initSelectionQa } from "./selection-qa";
import { initSupportHandoff } from "./support-handoff";

const CONTENT_BOOT = "__acornContentBoot";

type AcornContentWindow = Window & { [CONTENT_BOOT]?: boolean };
const contentWindow = window as AcornContentWindow;

/**
 * A frame that holds an application form: the top frame, a frame with enough
 * fields, or one whose page asks for a field of its own (an email-first sign-in
 * embedded under the site's consent panel).
 */
function isFormFrame(): boolean {
  return isAcornDomFrame() || pageFieldScore() >= MIN_PAGE_FIELDS;
}

/**
 * A frame the run reads or presses controls in: a form frame, or any frame whose
 * own elements the run read (a job posting in an embedded job-board frame).
 */
function isRunFrame(): boolean {
  return isFormFrame() || holdsAcornIds();
}

/**
 * Page work that touches form controls runs one at a time. A step that outlives its
 * reply must not keep clicking while the next step (or the leftover pass) starts.
 */
let fillQueue: Promise<unknown> = Promise.resolve();
function runExclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = fillQueue.then(work);
  fillQueue = run.catch(() => undefined);
  return run;
}

if (!contentWindow[CONTENT_BOOT]) {
  contentWindow[CONTENT_BOOT] = true;
  claimOwnDocument();
  initSelectionQa();
  initSupportHandoff();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MSG.FETCH_DOM) {
      void (async () => {
        const isTop = window === window.top;
        // A posting read wants the page's text now, not a form that may still hydrate.
        const posting = message.posting === true;
        const ownFields = pageFieldScore();
        const minScore = isTop || ownFields >= MIN_PAGE_FIELDS ? 1 : MIN_CHILD_FORM_CONTROLS;
        const waitStarted = Date.now();
        const score = posting ? formControlScore() : await waitForFormSurface(minScore);
        const formWaitMs = Date.now() - waitStarted;
        // Fields of the page itself, not of a layer laid over it, read once the form drew.
        const pageScore = posting ? ownFields : pageFieldScore();
        const acornFrame =
          posting || isTop || score >= MIN_CHILD_FORM_CONTROLS || pageScore >= MIN_PAGE_FIELDS;
        if (!acornFrame) {
          sendResponse({
            skipped: true,
            formScore: score,
            pageScore,
            url: window.location.href,
            title: document.title,
            fetchedAt: new Date().toISOString(),
            error: "Not a form frame",
          });
          return;
        }

        try {
          let started = Date.now();
          const tree = serializeDom(undefined, { posting });
          const serializeMs = Date.now() - started;
          // What an opening click drew is read first: its fields are then the scope's.
          const scope = message.scope === true ? readScope() : undefined;
          // A refill reads the issues once: they are sent, and they name the fields it plans.
          const flagged = message.flaggedFields === true;
          started = Date.now();
          const fieldIssues =
            message.fieldIssues === true || flagged ? scanFieldIssues() : undefined;
          const issuesMs = Date.now() - started;
          started = Date.now();
          const formFields =
            message.formFields !== true
              ? undefined
              : readFormFields({
                  pending: message.pendingFields === true,
                  blocked: message.blockedFields === true,
                  scoped: message.scopeFields === true,
                  flagged: flagged ? fieldIssues : null,
                });
          const fieldsMs = Date.now() - started;
          sendResponse({
            url: window.location.href,
            title: document.title,
            tree,
            fieldIssues: message.fieldIssues === true ? fieldIssues : undefined,
            formFields,
            scope,
            formScore: score,
            pageScore,
            fetchedAt: new Date().toISOString(),
            frameId: sender.frameId ?? null,
            timings: { formWaitMs, serializeMs, issuesMs, fieldsMs },
          });
        } catch (err) {
          sendResponse({ error: String(err), formScore: score });
        }
      })();
      return true;
    }

    if (message.type === MSG.HIGHLIGHT) {
      if (!isFormFrame()) return false;

      try {
        const el = resolveElementByNodeId(message.nodeId as number);
        if (el) {
          highlightElement(el);
          sendResponse({ ok: true });
        } else {
          sendResponse({ error: "Element not found in DOM" });
        }
      } catch (err) {
        sendResponse({ error: String(err) });
      }
      return true;
    }

    if (message.type === MSG.GET_CONTENT) {
      if (!isFormFrame()) return false;

      try {
        const content = getElementContent(
          message.nodeId as number,
          message.contentType as "innerHTML" | "innerText",
        );
        sendResponse({ ok: true, content });
      } catch (err) {
        sendResponse({ error: String(err) });
      }
      return true;
    }

    if (message.type === MSG.EXECUTE_ACTIONS) {
      if (!isFormFrame()) return false;

      executeActions(message.nodeId as number, message.steps)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ error: String(err) }));
      return true;
    }

    if (message.type === MSG.PLAN_STEP) {
      // Non-form frames must not claim the async channel (that caused silent hangs).
      if (!isFormFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }

      let settled = false;
      const respond = (payload: unknown) => {
        if (settled) return;
        settled = true;
        try {
          sendResponse(payload);
        } catch {
          // Channel may already be closed
        }
      };

      const receivedAt = Date.now();
      const step = message.step as PlanStepPayload;
      const timer = setTimeout(() => {
        traceFromPage("page:timeout", () => ({
          element_index: step.element_index,
          ms: Date.now() - receivedAt,
        }));
        respond({
          ok: false,
          error: `Plan step handler timed out inside the page (${PLAN_STEP_PAGE_TIMEOUT_MS / 1000}s)`,
        });
      }, PLAN_STEP_PAGE_TIMEOUT_MS);

      runExclusive(() => {
        traceFromPage("queue:start", () => ({
          element_index: step.element_index,
          waitedMs: Date.now() - receivedAt,
        }));
        return runPlanStep(step);
      })
        .then((result) => {
          clearTimeout(timer);
          respond(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          respond({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      return true;
    }

    if (message.type === MSG.FILL_LEFTOVER_COMBOS) {
      if (!isFormFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }
      traceFromPage("leftover:before", () => ({ combos: comboSnapshot() }));
      const deadline = Number(message.deadline) || Number.POSITIVE_INFINITY;
      // A scoped fill answers only the dropdowns of what the click opened; a refill
      // only those the page asks for (required, or marked invalid), never the
      // values the site put in itself.
      const scope = message.scoped === true ? (scopeTest() ?? (() => false)) : null;
      const flagged = message.flagged === true;
      const within = flagged
        ? (el: Element) => (!scope || scope(el)) && pageWantsAnswer(el)
        : scope;
      void runExclusive(() => fillLeftoverComboboxes(deadline, within, !flagged))
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return true;
    }

    if (message.type === MSG.COLLECT_CHOICES) {
      if (!isFormFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }
      try {
        sendResponse({ ok: true, items: collectChoiceItems(message.steps as ChoiceBatchStep[]) });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return false;
    }

    if (message.type === MSG.SCAN_FIELD_ISSUES) {
      if (!isFormFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }
      // Let the page re-validate the fields Refill just changed before reading errors again.
      void runExclusive(async () => {
        await waitForDomQuiet();
        return scanFieldIssues();
      })
        .then((scan) => sendResponse({ ok: true, scan }))
        .catch((err) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return true;
    }

    if (message.type === MSG.PAGE_PROBE) {
      if (!isRunFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }
      try {
        sendResponse({ ok: true, probe: probePage() });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return false;
    }

    if (message.type === MSG.REPAIR_DRIFT) {
      if (!isFormFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }
      void runExclusive(() => repairDrift(Number(message.since) || 0))
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true;
    }

    if (message.type === MSG.CLICK_CONTROL) {
      if (!isRunFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }
      void runExclusive(() =>
        Promise.resolve(
          prepareControlClick(message.nodeId as number, (click) => {
            pageTimeout(click, CLICK_AFTER_REPLY_MS);
          }),
        ),
      )
        .then((result) => sendResponse(result))
        .catch((err) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true;
    }

    if (message.type === MSG.SCOPE_CENSUS) {
      if (!isRunFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }
      void runExclusive(() => Promise.resolve(takeCensus()))
        .then(() => sendResponse({ ok: true }))
        .catch((err) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true;
    }

    if (message.type === MSG.SCOPE_STATE) {
      if (!isRunFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }
      // The page re-validates what was just saved before its state is read.
      void runExclusive(async () => {
        await waitForDomQuiet();
        return scopeState();
      })
        .then((state) => sendResponse({ ok: true, state }))
        .catch((err) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true;
    }

    if (message.type === MSG.SCOPE_END) {
      if (!isRunFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }
      endScope(message.committed === true);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === MSG.CLEAR_HIGHLIGHT) {
      if (!isFormFrame()) return false;

      clearHighlight();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });
}
