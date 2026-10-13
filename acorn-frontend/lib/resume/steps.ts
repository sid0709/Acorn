import {
  newResumeStep,
  type ResumeGenStep,
  type ResumeGeneratorConfig,
} from "@acorn/shared/resume-config";
import {
  RESUME_PURPOSES,
  RESUME_SECTION_LABEL,
  type ResumePurpose,
} from "@acorn/shared/resume-templates";

/** Generation is blocked while any step has one of these. Keyed by step id. */
export function stepIssues(config: ResumeGeneratorConfig): Record<string, string> {
  const issues: Record<string, string> = {};
  for (const purpose of RESUME_PURPOSES) {
    const finals = config.steps.filter((step) => step.purpose === purpose && step.kind === "final");
    if (finals.length > 1) {
      for (const step of finals.slice(1)) {
        issues[step.id] =
          `${RESUME_SECTION_LABEL[purpose]} already has a final step. Only one is allowed.`;
      }
    }
  }
  for (const step of config.steps) {
    if (issues[step.id]) continue;
    if (step.kind === "final" && step.schema.trim() && !isJson(step.schema)) {
      issues[step.id] = "The output schema is not valid JSON.";
    } else if (step.kind === "fine-tune" && !step.prompt.trim()) {
      issues[step.id] = "A fine-tune step needs a prompt.";
    }
  }
  return issues;
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function withStep(
  config: ResumeGeneratorConfig,
  id: string,
  patch: Partial<ResumeGenStep>,
): ResumeGeneratorConfig {
  return {
    ...config,
    steps: config.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
  };
}

/** Swap a step with its nearest neighbor in the same section: steps of other sections do not share its draft. */
export function withStepMoved(
  config: ResumeGeneratorConfig,
  id: string,
  direction: -1 | 1,
): ResumeGeneratorConfig {
  const steps = [...config.steps];
  const from = steps.findIndex((step) => step.id === id);
  if (from < 0) return config;
  let to = from + direction;
  while (to >= 0 && to < steps.length && steps[to].purpose !== steps[from].purpose) to += direction;
  if (to < 0 || to >= steps.length) return config;
  [steps[from], steps[to]] = [steps[to], steps[from]];
  return { ...config, steps };
}

/** Removes a fine-tune step. Every section keeps its final step. */
export function withStepRemoved(config: ResumeGeneratorConfig, id: string): ResumeGeneratorConfig {
  return {
    ...config,
    steps: config.steps.filter((step) => step.id !== id || step.kind === "final"),
  };
}

/** A new fine-tune step, placed just before its section's final step so it refines the draft first. */
export function withFineTuneAdded(
  config: ResumeGeneratorConfig,
  purpose: ResumePurpose,
): ResumeGeneratorConfig {
  const steps = [...config.steps];
  const final = steps.findIndex((step) => step.purpose === purpose && step.kind === "final");
  steps.splice(final < 0 ? steps.length : final, 0, newResumeStep(purpose, "fine-tune"));
  return { ...config, steps };
}

/** The prompt with a token on its own space-separated end. */
export function withToken(prompt: string, token: string): string {
  if (!prompt) return token;
  return `${prompt}${/\s$/.test(prompt) ? "" : " "}${token}`;
}
