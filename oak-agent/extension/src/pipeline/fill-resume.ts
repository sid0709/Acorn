import { sameApplySite } from "../../../shared/apply-site";
import type { RuntimeAttachedFile } from "../../../shared/plan-runner/types";
import { customTabHasResume, type OakCustomTabBinding } from "../tab-custom-session";
import { getJobGenerate } from "../tab-job-generate-session";
import type { OakTabJobBinding } from "../tab-job-session";
import type { PipelineSource } from "../types";
import {
  fetchCustomLibraryResume,
  fetchCustomResume,
  fetchRecommendedResume,
  fetchRuntimeFile,
} from "./ai-client";

/** The file key the planner's resume_upload step reads. */
const RECOMMENDED_RESUME_KEY = "recommended_resume";

const WRONG_SITE = "Page is not this job's apply site — skipped resume upload";

export async function loadFillResume(input: {
  source?: PipelineSource;
  tabJob: OakTabJobBinding | null;
  customTab?: OakCustomTabBinding | null;
  customGenerationId?: string | null;
  apiUrl: string;
}): Promise<{ file: RuntimeAttachedFile | null; skipReason: string | null }> {
  const customPicked = Boolean(input.customTab && customTabHasResume(input.customTab));
  if (customPicked) {
    return loadCustomFillResume(input);
  }

  const tabJob = input.tabJob;
  if (!tabJob?.jobId) {
    return loadPrimaryLibraryResume(input.apiUrl);
  }

  const jobGen = await getJobGenerate(tabJob.jobId);
  const generationId = String(jobGen?.generationId || "").trim();
  if (generationId && jobGen?.generateStatus === "completed") {
    try {
      const file = await fetchCustomResume(generationId, input.apiUrl);
      if (file) return { file, skipReason: null };
    } catch (err) {
      return {
        file: null,
        skipReason: err instanceof Error ? err.message : String(err),
      };
    }
  }
  const libraryId = String(jobGen?.recommendedResumeId || "").trim();
  if (libraryId && jobGen?.generateStatus === "completed" && jobGen.workKind === "recommend") {
    try {
      const file = await fetchCustomLibraryResume(libraryId, input.apiUrl);
      if (file) return { file, skipReason: null };
    } catch (err) {
      return {
        file: null,
        skipReason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    const file = await fetchRecommendedResume(tabJob.jobId, input.apiUrl);
    if (!file) {
      return {
        file: null,
        skipReason: tabJob.resumeStack
          ? `Could not load the ${tabJob.resumeStack} file`
          : "No generated or recommended resume for this job",
      };
    }
    return { file, skipReason: null };
  } catch (err) {
    return {
      file: null,
      skipReason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** No job and no picked résumé: upload the primary résumé from the Acorn Library. */
async function loadPrimaryLibraryResume(
  apiUrl: string,
): Promise<{ file: RuntimeAttachedFile | null; skipReason: string | null }> {
  try {
    const file = await fetchRuntimeFile(apiUrl);
    if (!file) {
      return { file: null, skipReason: "No résumé in your Acorn Library" };
    }
    return { file: { ...file, key: RECOMMENDED_RESUME_KEY }, skipReason: null };
  } catch (err) {
    return { file: null, skipReason: err instanceof Error ? err.message : String(err) };
  }
}

async function loadCustomFillResume(input: {
  customTab?: OakCustomTabBinding | null;
  customGenerationId?: string | null;
  apiUrl: string;
}): Promise<{ file: RuntimeAttachedFile | null; skipReason: string | null }> {
  const tab = input.customTab;
  const recommending = tab?.resumeMode === "recommend";
  const libraryId = String(tab?.recommendedResumeId || "").trim();
  const generationId = String(tab?.generationId || input.customGenerationId || "").trim();

  if (recommending) {
    if (!libraryId) {
      return { file: null, skipReason: "Recommend a Library résumé first" };
    }
    try {
      const file = await fetchCustomLibraryResume(libraryId, input.apiUrl);
      if (!file) {
        return {
          file: null,
          skipReason: "Could not load the recommended Library résumé",
        };
      }
      return { file, skipReason: null };
    } catch (err) {
      return {
        file: null,
        skipReason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (!generationId) {
    return { file: null, skipReason: "Generate a résumé for this tab first" };
  }
  try {
    const file = await fetchCustomResume(generationId, input.apiUrl);
    if (!file) {
      return {
        file: null,
        skipReason: "Could not load the stored editor résumé",
      };
    }
    return { file, skipReason: null };
  } catch (err) {
    return {
      file: null,
      skipReason: err instanceof Error ? err.message : String(err),
    };
  }
}

export function keepResumeIfSameSite(
  file: RuntimeAttachedFile | null,
  tabJob: OakTabJobBinding | null,
  pageUrl: string,
  skipReason: string | null,
): { file: RuntimeAttachedFile | null; skipReason: string | null } {
  if (!file) return { file: null, skipReason };
  if (!tabJob?.applyUrl || sameApplySite(pageUrl, tabJob.applyUrl)) {
    return { file, skipReason: null };
  }
  return { file: null, skipReason: WRONG_SITE };
}
