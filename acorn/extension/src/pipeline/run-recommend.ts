import {
  emptyGenerateCheckpoint,
  formatGenerateFailure,
  isStepDone,
  markGenerateFailed,
  markStepDone,
  type GenerateCheckpoint,
} from "@acorn/shared/generate-checkpoint";

import { broadcastOperatorNotice } from "../operator-notice";

import { recommendCustomLibrary } from "./api/custom-library";
import { customRecommendProgress } from "./custom-recommend-progress";

import type { ResumeGenerateSource, ResumeGenerateStore } from "./run-generate";
import type { RecommendedResumeRank } from "@acorn/shared/resume-library";

export async function runResumeRecommend(args: {
  source: ResumeGenerateSource;
  apiUrl: string;
  continue?: boolean;
  tabId?: number | null;
  loadJd: () => Promise<{ jobDescription: string; title?: string; url?: string }>;
  store: ResumeGenerateStore & {
    complete: (result: {
      recommendedResumeId: string;
      recommendedResumeStack: string;
      recommendedResumeReason: string | null;
      recommendedTop: RecommendedResumeRank[];
      checkpoint: GenerateCheckpoint;
      jobDescription: string;
    }) => Promise<void>;
  };
}): Promise<void> {
  const { source, apiUrl, tabId, loadJd, store } = args;
  const existing = args.continue ? await store.readCheckpoint() : null;
  let checkpoint = args.continue && existing ? existing : emptyGenerateCheckpoint();
  checkpoint = { ...checkpoint, failedStep: null, error: null };

  const persistRunning = async (phase: "load-jd" | "recommend") => {
    await store.patch({
      workKind: "recommend",
      resumeMode: "recommend",
      generateStatus: "running",
      generateError: null,
      generateProgress: customRecommendProgress({
        status: "running",
        phase,
        source,
      }),
      checkpoint,
      jobDescription: checkpoint.outputs.jobDescription,
    });
  };

  const fail = async (step: "load-jd" | "summary", error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    checkpoint = markGenerateFailed(checkpoint, step, message);
    await store.patch({
      workKind: "recommend",
      resumeMode: "recommend",
      generateStatus: "failed",
      generateError: message,
      generateProgress: customRecommendProgress({
        status: "failed",
        phase: step === "load-jd" ? "load-jd" : "recommend",
        source,
      }),
      checkpoint,
      jobDescription: checkpoint.outputs.jobDescription,
    });
    broadcastOperatorNotice({
      kind: "error",
      title: source === "fill" ? "Fill recommend failed" : "Recommend failed",
      detail:
        formatGenerateFailure({
          status: "failed",
          workKind: "recommend",
          error: message,
          checkpoint,
        }) || message,
      ...(typeof tabId === "number" ? { tabId } : {}),
    });
    throw error instanceof Error ? error : new Error(message);
  };

  await store.patch({
    workKind: "recommend",
    resumeMode: "recommend",
    generateStatus: "queued",
    generateError: null,
    generateProgress: customRecommendProgress({
      status: "queued",
      phase: isStepDone(checkpoint, "load-jd") ? "recommend" : "load-jd",
      source,
    }),
    checkpoint,
  });

  try {
    if (!isStepDone(checkpoint, "load-jd")) {
      await persistRunning("load-jd");
      const loaded = await loadJd();
      const jobDescription = loaded.jobDescription.trim();
      if (!jobDescription) {
        await fail("load-jd", new Error("No job description to recommend from"));
        return;
      }
      checkpoint = {
        ...markStepDone(checkpoint, "load-jd"),
        outputs: {
          ...checkpoint.outputs,
          jobDescription,
          title: loaded.title?.trim() || checkpoint.outputs.title,
          url: loaded.url?.trim() || checkpoint.outputs.url,
        },
      };
    }

    await persistRunning("recommend");
    const jobDescription = checkpoint.outputs.jobDescription;
    if (!jobDescription) {
      await fail("load-jd", new Error("No job description to recommend from"));
      return;
    }
    const result = await recommendCustomLibrary(
      {
        jobDescription,
        title: checkpoint.outputs.title || undefined,
        url: checkpoint.outputs.url || undefined,
      },
      apiUrl,
      tabId,
    );
    checkpoint = markStepDone(
      markStepDone(markStepDone(markStepDone(checkpoint, "summary"), "skills"), "experience"),
      "finalize",
    );
    await args.store.complete({
      recommendedResumeId: result.recommendedResumeId,
      recommendedResumeStack: result.recommendedResumeStack,
      recommendedResumeReason: result.recommendedResumeReason,
      recommendedTop: result.recommendedTop,
      checkpoint,
      jobDescription,
    });
  } catch (err) {
    const status = await store.readStatus();
    if (status === "failed") throw err;
    await fail(isStepDone(checkpoint, "load-jd") ? "summary" : "load-jd", err);
  }
}
