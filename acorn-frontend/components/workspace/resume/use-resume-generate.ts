"use client";

import { useState } from "react";
import {
  loadGeneration,
  pollResumeGenerate,
  saveResumeConfig,
  startResumeGenerate,
} from "@/lib/resume/api";
import type { ResumeGeneratorConfig } from "@acorn/shared/resume-config";
import type { ResumeIdentity } from "@acorn/shared/resume-content";

const POLL_MS = 800;
/** The server stops a run after four minutes (generateTimeout in acorn-backend/resume). */
const GENERATE_TIMEOUT_MS = 4 * 60 * 1000;
const MAX_POLLS = Math.ceil(GENERATE_TIMEOUT_MS / POLL_MS);

export type GenerateState = {
  busy: string;
  doneSteps: number;
  /** Every step in the run: loading the posting, each configured step, and finishing. */
  totalSteps: number;
  /** Written sections so far: partial while running, final once done, null before the first run. */
  sections: Record<string, unknown> | null;
  generationId: string | null;
};

const IDLE: GenerateState = {
  busy: "",
  doneSteps: 0,
  totalSteps: 0,
  sections: null,
  generationId: null,
};

/** Starts a run, polls it, and hands back sections as they are written so the preview fills in live. */
export function useResumeGenerate(onError: (message: string) => void) {
  const [state, setState] = useState<GenerateState>(IDLE);
  const patch = (next: Partial<GenerateState>) => setState((current) => ({ ...current, ...next }));
  const fail = (message: string) => {
    patch({ busy: "" });
    onError(message);
  };

  const generate = async (
    config: ResumeGeneratorConfig,
    jobDescription: string,
    identity: ResumeIdentity,
  ) => {
    setState({ ...IDLE, busy: "Saving design" });
    const saved = await saveResumeConfig({ ...config, jobDescription });
    if (!saved.ok) return fail(saved.message);
    patch({ busy: "Writing your résumé" });
    const started = await startResumeGenerate({ jobDescription, identity });
    if (!started.ok || !started.data.inputId) {
      return fail(started.ok ? "Generate did not start." : started.message);
    }
    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      const polled = await pollResumeGenerate(started.data.inputId);
      if (!polled.ok) return fail(polled.message);
      const { status, progress, partialSections, generationId, error } = polled.data;
      patch({
        doneSteps: progress?.steps.filter((step) => step.status === "done").length ?? 0,
        totalSteps: progress?.steps.length ?? 0,
        ...(partialSections ? { sections: partialSections } : {}),
      });
      if (status === "failed") return fail(error || "Generation failed.");
      if (status === "completed" && generationId) {
        const run = await loadGeneration(generationId);
        setState((current) => ({
          busy: "",
          doneSteps: current.totalSteps,
          totalSteps: current.totalSteps,
          generationId,
          sections: (run.ok && run.data.run.sections) || current.sections,
        }));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    fail("Generation is still running. Open History in a moment.");
  };

  return { ...state, generate };
}
