import type { PlanStepPayload, PlanStepResult } from "../types";
import { rewriteApplicantIdentityValue } from "@acorn/shared/plan-runner/applicant-identity";
import { isCustomResumeFile } from "@acorn/shared/plan-runner/step-file";
import { shownValue } from "@acorn/shared/secret-value";
import { controlAlreadyMatches } from "./agents/already-filled";
import { clearElement } from "./agents/clear";
import { fillElement } from "./agents/fill";
import { rememberPlanFilled } from "./agents/plan-fill-registry";
import { selectComboboxOption } from "./agents/select-combobox";
import { opensOptionList, visibleStandIn } from "./agents/stand-in";
import { readControlValue } from "./agents/read-control-value";
import { resumeUpload } from "./agents/resume-upload";
import { selectRadioElement } from "./agents/select-radio";
import { uploadFileToElement } from "./agents/upload";
import { validateElementIndexes } from "./agents/validate";
import { waitMs } from "./agents/wait";
import { highlightElement } from "./highlighter";
import { verifyElementByPlan, type VerifyResult } from "./verify-element";
import { relocateElementByPlan } from "./verify/relocate";
import { traceFromPage } from "../debug-trace";
import { comboSnapshot, describeEl, describeWidget } from "./debug-snapshot";

function nearbyQuestionText(el: Element, expectedLabel: string | null): string {
  const bits = [expectedLabel || ""];
  const html = el as HTMLElement;
  bits.push(html.getAttribute("aria-label") || "");
  let node: Element | null = el;
  for (let i = 0; i < 8 && node; i += 1) {
    bits.push(node.getAttribute("aria-label") || "");
    const heading = node.querySelector(
      ":scope > label, :scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4",
    );
    if (heading?.textContent) bits.push(heading.textContent);
    const prev = node.previousElementSibling as HTMLElement | null;
    if (prev) bits.push(prev.innerText || prev.textContent || "");
    node = node.parentElement;
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
        const valueAfter = await resumeUpload(root, step.file, step.expected_label);
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
  traceFromPage("step:start", () => ({
    action: step.action,
    element_index: step.element_index,
    expected_label: step.expected_label,
    planValue: step.value,
    intended,
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
      rememberPlanFilled(el, step, readControlValue(el));
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
        valueAfter = await uploadFileToElement(el, step.file);
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
        valueAfter = await resumeUpload(el, step.file, step.expected_label);
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
    rememberPlanFilled(el, step, readControlValue(el));
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
