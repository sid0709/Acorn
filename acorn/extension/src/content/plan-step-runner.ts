import { rewriteApplicantIdentityValue } from "@acorn/shared/plan-runner/applicant-identity";
import { isCustomResumeFile } from "@acorn/shared/plan-runner/step-file";
import {
  HIDDEN_VALUE,
  PASSWORD_ROLE,
  isSecretControl,
  shownValue,
} from "@acorn/shared/secret-value";

import { traceFromPage } from "../debug-trace";

import { controlAlreadyMatches } from "./agents/already-filled";
import { fieldHoldsFile } from "./agents/attached-file";
import { clearElement } from "./agents/clear";
import { fillElement } from "./agents/fill";
import { rememberAnsweredGroup, rememberPlanFilled } from "./agents/plan-fill-registry";
import { readControlValue } from "./agents/read-control-value";
import { resumeUpload } from "./agents/resume-upload";
import { selectComboboxOption } from "./agents/select-combobox";
import {
  answersByPlainButtons,
  chosenOptionLabel,
  selectRadioElement,
} from "./agents/select-radio";
import { opensOptionList, visibleStandIn } from "./agents/stand-in";
import { uploadFileToElement } from "./agents/upload";
import { validateElementIndexes } from "./agents/validate";
import { waitMs } from "./agents/wait";
import { comboSnapshot, describeEl, describeWidget } from "./debug-snapshot";
import { NAMED_GROUP_SELECTOR, choiceGroupKey } from "./form-dom";
import { FILLABLE_SELECTOR } from "./form-frame";
import { highlightElement } from "./highlighter";
import { relocateElementByPlan } from "./verify/relocate";
import { verifyElementByPlan, type VerifyResult } from "./verify-element";

import type { PlanStepPayload, PlanStepResult } from "../types";

/** Every control a question can have, checkboxes and radios drawn as divs included. */
const QUESTION_CONTROL_SELECTOR = `${FILLABLE_SELECTOR}, [role="checkbox"], [role="radio"]`;

/**
 * What a control shows as its answer. A step on a set of options (pills, drawn
 * radios) may name any one of them: the set answers through the one chosen.
 */
function answerShown(el: Element): string {
  return chosenOptionLabel(el) || readControlValue(el);
}

/** Whether node holds a control of another question than the one `own` belongs to. */
function holdsAnotherQuestion(node: Element, el: Element, own: Element): boolean {
  const name = el.getAttribute("name");
  return Array.from(node.querySelectorAll(QUESTION_CONTROL_SELECTOR)).some(
    (control) =>
      control !== el &&
      !own.contains(control) &&
      !control.contains(el) &&
      !(name && control.getAttribute("name") === name),
  );
}

/**
 * The words of the question `el` answers: its label, and the headings and text
 * before it inside its own question. The climb stops at the first container that
 * also holds another question, so a form's header or job description (which can
 * say anything) is never read as this field's question.
 */
function nearbyQuestionText(el: Element, expectedLabel: string | null): string {
  const bits = [expectedLabel || ""];
  const own = el.closest(NAMED_GROUP_SELECTOR) ?? el;
  let node: Element | null = el;
  for (let i = 0; i < 8 && node; i += 1) {
    bits.push(node.getAttribute("aria-label") || "");
    const heading = node.querySelector(
      ":scope > label, :scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4",
    );
    if (heading?.textContent) bits.push(heading.textContent);
    const parent: Element | null = node.parentElement;
    if (!parent || holdsAnotherQuestion(parent, el, own)) break;
    const prev = node.previousElementSibling as HTMLElement | null;
    if (prev) bits.push(prev.innerText || prev.textContent || "");
    node = parent;
  }
  return bits.join(" ");
}

export async function runPlanStep(step: PlanStepPayload): Promise<PlanStepResult> {
  if (step.action === "wait") {
    const ms = await waitMs(step.ms);
    return { ok: true, verified: true, acted: true, details: { valueAfter: `${ms}ms` } };
  }

  if (step.action === "validate") {
    const indexes = step.element_indexes ?? [];
    if (!indexes.length) {
      return {
        ok: false,
        verified: false,
        acted: false,
        error: "validate requires element_indexes",
      };
    }
    const result = validateElementIndexes(indexes);
    return {
      ok: result.ok,
      verified: result.ok,
      acted: true,
      error: result.error,
      details: {
        valueAfter: result.results
          .filter((r) => r.ok)
          .map((r) => `${r.nodeId}=${r.valueAfter ?? ""}`)
          .join(", "),
      },
    };
  }

  if (step.element_index == null) {
    if (step.action === "resume_upload" && step.file?.base64) {
      const root = document.body || document.documentElement;
      if (!root) {
        return {
          ok: false,
          verified: false,
          acted: false,
          error: `${step.action} requires element_index`,
        };
      }
      try {
        const valueAfter = await resumeUpload(root, step.file, step.expected_label, step.value);
        return {
          ok: true,
          verified: true,
          acted: true,
          details: { valueAfter },
        };
      } catch (err) {
        return {
          ok: false,
          verified: true,
          acted: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return {
      ok: false,
      verified: false,
      acted: false,
      error: `${step.action} requires element_index`,
    };
  }

  let verified = verifyElementByPlan(step.element_index, step.expected_label, step.expected_role);

  if (!verified.ok || !verified.element) {
    const fallback = relocateElementByPlan(step.expected_label, step.expected_role, step.value);
    if (fallback.ok && fallback.element) {
      verified = fallback;
    } else {
      return {
        ok: false,
        verified: false,
        acted: false,
        error: verified.error || "Verification failed",
        details: {
          nodeId: step.element_index,
          matchedLabel: verified.matchedLabel,
          matchedRole: verified.matchedRole,
        },
      };
    }
  }

  return actOnVerified(step, verified);
}

/**
 * Run one step on the control it resolved to. A repair calls this directly with
 * the control it recorded, since node ids from an earlier read no longer hold.
 */
export async function actOnVerified(
  step: PlanStepPayload,
  verified: VerifyResult,
): Promise<PlanStepResult> {
  // A step that names an invisible companion input acts on the visible control of its field.
  const el = verified.element ? visibleStandIn(verified.element) : verified.element;
  // A replayed step has no node id from this read; its control was resolved already.
  const nodeId = step.element_index ?? undefined;
  if (!el) {
    return {
      ok: false,
      verified: false,
      acted: false,
      error: verified.error || "Verification failed",
    };
  }

  highlightElement(el);

  const questionText = nearbyQuestionText(
    el,
    [step.expected_label, verified.matchedLabel].filter(Boolean).join(" "),
  );
  let intended = step.value;
  const identityValue = rewriteApplicantIdentityValue(questionText, intended);
  if (identityValue !== intended) {
    intended = identityValue ?? null;
  }

  const startedAt = Date.now();
  const secretStep = isSecretControl(el) || step.expected_role === PASSWORD_ROLE;
  traceFromPage("step:start", () => ({
    action: step.action,
    element_index: step.element_index,
    expected_label: step.expected_label,
    // A password never reaches a trace: shown as hidden, by its box or its role.
    planValue: secretStep ? HIDDEN_VALUE : step.value,
    intended: secretStep ? HIDDEN_VALUE : intended,
    el: describeEl(el),
    widget: describeWidget(el),
    combos: comboSnapshot(),
  }));

  if (step.action === "verify_only") {
    return {
      ok: true,
      verified: true,
      acted: false,
      details: {
        nodeId,
        matchedLabel: verified.matchedLabel,
        matchedRole: verified.matchedRole,
      },
    };
  }

  if (step.action === "clear" && !readControlValue(el)) {
    return {
      ok: true,
      verified: true,
      acted: false,
      alreadyFilled: true,
      details: {
        nodeId,
        matchedLabel: verified.matchedLabel,
        matchedRole: verified.matchedRole,
        valueAfter: "",
      },
    };
  }

  // The field holds this very file already: the page took the upload and drew itself
  // again with the file attached. Sending it again would start the page's own upload
  // (and the reload or reset that follows it) over, so not even Refill resends it.
  if (
    (step.action === "upload" || step.action === "resume_upload") &&
    fieldHoldsFile(el, step.file)
  ) {
    traceFromPage("step:file-held", () => ({ element_index: step.element_index }));
    return {
      ok: true,
      verified: true,
      acted: false,
      alreadyFilled: true,
      details: {
        nodeId,
        matchedLabel: verified.matchedLabel,
        matchedRole: verified.matchedRole,
        valueAfter: step.file?.name,
      },
    };
  }

  // Resume / browser autofill may already populate the control — don't overwrite
  // when the live value already matches the planned answer. Refill forces the
  // write: the page rejected what the control shows.
  if (
    !step.force &&
    (step.action === "fill" ||
      step.action === "select_radio" ||
      step.action === "upload" ||
      step.action === "resume_upload")
  ) {
    const prior = controlAlreadyMatches(el, intended, {
      fileName: step.file?.name ?? null,
    });
    traceFromPage("step:already-check", () => ({
      element_index: step.element_index,
      intended: shownValue(el, intended),
      matched: prior.matched,
      current: shownValue(el, prior.current),
    }));
    if (prior.matched) {
      rememberPlanFilled(el, step, answerShown(el), !answersByPlainButtons(el));
      return {
        ok: true,
        verified: true,
        acted: false,
        alreadyFilled: true,
        details: {
          nodeId,
          matchedLabel: verified.matchedLabel,
          matchedRole: verified.matchedRole,
          valueAfter: shownValue(el, prior.current),
        },
      };
    }
  }

  try {
    let valueAfter: string | undefined;

    switch (step.action) {
      case "fill": {
        if (intended == null || intended === "") {
          throw new Error("fill requires value");
        }
        valueAfter = await fillElement(el, intended, step.expected_label);
        break;
      }
      case "clear": {
        valueAfter = await clearElement(el);
        break;
      }
      case "upload": {
        if (!step.file?.base64) {
          throw new Error("upload requires runtime file payload");
        }
        valueAfter = await uploadFileToElement(el, step.file, step.value);
        break;
      }
      case "resume_upload": {
        if (!step.file?.base64) {
          throw new Error(
            isCustomResumeFile(step.file)
              ? "resume_upload requires the generated résumé"
              : "resume_upload requires the recommended Library resume",
          );
        }
        valueAfter = await resumeUpload(el, step.file, step.expected_label, step.value);
        break;
      }
      case "select_radio": {
        // A pick on a control that opens a list is answered by opening it and picking.
        valueAfter = opensOptionList(el)
          ? await selectComboboxOption(el, intended ?? "", step.expected_label)
          : await selectRadioElement(el, intended, step.expected_label);
        break;
      }
      default:
        throw new Error(`Unsupported plan step action: ${step.action}`);
    }

    const after = valueAfter ?? readControlValue(el);
    // A typed answer the page does not hold (the widget cleared or refused it) is a
    // failed step: passing it as done would leave the field empty without a word.
    if (step.action === "fill" && !readControlValue(el).trim() && !after.trim()) {
      throw new Error("The page did not keep the typed value");
    }
    // A plain button keeps no state: its answer is never replayed, since a second
    // press may undo it.
    rememberPlanFilled(el, step, answerShown(el), !answersByPlainButtons(el));
    if (step.action === "select_radio") rememberAnsweredGroup(choiceGroupKey(el));
    traceFromPage("step:acted", () => ({
      element_index: step.element_index,
      intended: shownValue(el, intended),
      valueAfter: shownValue(el, valueAfter),
      readAfter: shownValue(el, readControlValue(el)),
      ms: Date.now() - startedAt,
    }));
    return {
      ok: true,
      verified: true,
      acted: true,
      details: {
        nodeId,
        matchedLabel: verified.matchedLabel,
        matchedRole: verified.matchedRole,
        valueAfter: shownValue(el, after),
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    traceFromPage("step:error", () => ({
      element_index: step.element_index,
      intended: shownValue(el, intended),
      error,
      readAfter: shownValue(el, readControlValue(el)),
      ms: Date.now() - startedAt,
    }));
    return {
      ok: false,
      verified: true,
      acted: false,
      error,
      details: {
        nodeId,
        matchedLabel: verified.matchedLabel,
        matchedRole: verified.matchedRole,
      },
    };
  }
}
