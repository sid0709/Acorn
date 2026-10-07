import { ACORN_DEBUG, DEBUG_HTML_MAX_CHARS, traceFromPage } from "../debug-trace";
import { MSG, PLAN_STEP_PAGE_TIMEOUT_MS, type PlanStepPayload } from "../types";

import { executeActions, getElementContent } from "./action-runner";
import { CLICK_AFTER_REPLY_MS, prepareControlClick } from "./click-control";
import { fillLeftoverComboboxes } from "./agents/leftover-combobox";
import { waitForDomQuiet } from "./agents/wait";
import { collectChoiceItems, type ChoiceBatchStep } from "./choice-batch";
import { comboSnapshot } from "./debug-snapshot";
import { repairDrift } from "./drift-repair";
import { probePage } from "./page-probe";
import { serializeDom } from "./dom-serializer";
import { resolveElementByNodeId } from "./element-resolver";
import { scanFieldIssues } from "./field-errors";
import { scanFormFields } from "./form-fields";
import {
  MIN_CHILD_FORM_CONTROLS,
  formControlScore,
  isAcornDomFrame,
  waitForFormSurface,
} from "./form-frame";
import { clearHighlight, highlightElement } from "./highlighter";
import { scanPendingFormFields } from "./pending-fields";
import { runPlanStep } from "./plan-step-runner";
import { initSelectionQa } from "./selection-qa";

const CONTENT_BOOT = "__acornContentBoot";

type AcornContentWindow = Window & { [CONTENT_BOOT]?: boolean };
const contentWindow = window as AcornContentWindow;

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
  initSelectionQa();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MSG.FETCH_DOM) {
      void (async () => {
        const isTop = window === window.top;
        // A posting read wants the page's text now, not a form that may still hydrate.
        const posting = message.posting === true;
        const minScore = isTop ? 1 : MIN_CHILD_FORM_CONTROLS;
        const score = posting ? formControlScore() : await waitForFormSurface(minScore);
        const acornFrame = posting || isTop || score >= MIN_CHILD_FORM_CONTROLS;
        if (!acornFrame) {
          sendResponse({
            skipped: true,
            formScore: score,
            url: window.location.href,
            title: document.title,
            fetchedAt: new Date().toISOString(),
            error: "Not a form frame",
          });
          return;
        }

        try {
          const tree = serializeDom();
          sendResponse({
            url: window.location.href,
            title: document.title,
            tree,
            fieldIssues: message.fieldIssues === true ? scanFieldIssues() : undefined,
            formFields:
              message.formFields !== true
                ? undefined
                : message.pendingFields === true
                  ? scanPendingFormFields()
                  : scanFormFields(),
            formScore: score,
            fetchedAt: new Date().toISOString(),
            frameId: sender.frameId ?? null,
            html: ACORN_DEBUG
              ? document.documentElement.outerHTML.slice(0, DEBUG_HTML_MAX_CHARS)
              : undefined,
          });
        } catch (err) {
          sendResponse({ error: String(err), formScore: score });
        }
      })();
      return true;
    }

    if (message.type === MSG.HIGHLIGHT) {
      if (!isAcornDomFrame()) return false;

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
      if (!isAcornDomFrame()) return false;

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
      if (!isAcornDomFrame()) return false;

      executeActions(message.nodeId as number, message.steps)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ error: String(err) }));
      return true;
    }

    if (message.type === MSG.PLAN_STEP) {
      // Non-form frames must not claim the async channel (that caused silent hangs).
      if (!isAcornDomFrame()) {
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
      if (!isAcornDomFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }
      traceFromPage("leftover:before", () => ({ combos: comboSnapshot() }));
      void runExclusive(fillLeftoverComboboxes)
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
      if (!isAcornDomFrame()) {
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
      if (!isAcornDomFrame()) {
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
      if (!isAcornDomFrame()) {
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
      if (!isAcornDomFrame()) {
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
      if (!isAcornDomFrame()) {
        sendResponse({ ok: false, skipped: true, error: "Not a form frame" });
        return false;
      }
      void runExclusive(async () =>
        prepareControlClick(message.nodeId as number, (click) => {
          setTimeout(click, CLICK_AFTER_REPLY_MS);
        }),
      )
        .then((result) => sendResponse(result))
        .catch((err) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true;
    }

    if (message.type === MSG.CLEAR_HIGHLIGHT) {
      if (!isAcornDomFrame()) return false;

      clearHighlight();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });
}
