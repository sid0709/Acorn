import { describe, expect, test } from "bun:test";
import { defaultResumeConfig } from "@acorn/shared/resume-config";
import {
  stepIssues,
  withFineTuneAdded,
  withStep,
  withStepMoved,
  withStepRemoved,
  withToken,
} from "./steps";

describe("resume prompt steps", () => {
  test("a fine-tune step lands before its section's final step", () => {
    const config = withFineTuneAdded(defaultResumeConfig(), "skills");
    expect(config.steps.map((step) => `${step.purpose}:${step.kind}`)).toEqual([
      "summary:final",
      "skills:fine-tune",
      "skills:final",
      "experience:final",
    ]);
  });

  test("final steps cannot be removed, fine-tune steps can", () => {
    const added = withFineTuneAdded(defaultResumeConfig(), "summary");
    const fineTune = added.steps[0];
    expect(withStepRemoved(added, fineTune.id).steps).toHaveLength(3);
    const final = added.steps[1];
    expect(withStepRemoved(added, final.id).steps).toHaveLength(4);
  });

  test("moving swaps within a section and leaves other sections alone", () => {
    const added = withFineTuneAdded(defaultResumeConfig(), "experience");
    const last = added.steps[3];
    const moved = withStepMoved(added, last.id, -1);
    expect(moved.steps.slice(2).map((step) => step.kind)).toEqual(["final", "fine-tune"]);
    expect(withStepMoved(added, added.steps[1].id, 1)).toBe(added);
  });

  test("issues name a second final, a bad schema, and a blank fine-tune prompt", () => {
    const base = defaultResumeConfig();
    expect(stepIssues(base)).toEqual({});
    const twoFinals = {
      ...base,
      steps: [...base.steps, { ...base.steps[0], id: "dup" }],
    };
    expect(stepIssues(twoFinals).dup).toContain("already has a final step");
    const badSchema = withStep(base, base.steps[0].id, { schema: "{nope" });
    expect(stepIssues(badSchema)[base.steps[0].id]).toContain("not valid JSON");
    const blank = withFineTuneAdded(base, "skills");
    expect(Object.values(stepIssues(blank))[0]).toContain("needs a prompt");
  });

  test("tokens append after a space", () => {
    expect(withToken("", "{career}")).toBe("{career}");
    expect(withToken("Use", "{career}")).toBe("Use {career}");
    expect(withToken("Use ", "{career}")).toBe("Use {career}");
  });
});
