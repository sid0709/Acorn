import { customTabHasResume, getCustomTab, rememberCustomTab } from "../tab-custom-session";
import { getJobGenerate } from "../tab-job-generate-session";
import { getTabJob } from "../tab-job-session";

import { runCustomRecommend } from "./custom-recommend";
import { runJobRecommend } from "./job-recommend";

import type { RunLog } from "./run-log";

/** Whether this tab already has a résumé Fill can attach. */
async function hasResume(tabId: number): Promise<boolean> {
  const customTab = await getCustomTab(tabId);
  if (customTab && customTabHasResume(customTab)) return true;
  const tabJob = await getTabJob(tabId);
  if (!tabJob) return false;
  if (tabJob.resumeStack) return true;
  const generate = await getJobGenerate(tabJob.jobId);
  return Boolean(generate?.recommendedResumeId || generate?.generationId);
}

/**
 * Recommend a Library résumé for this tab when it has none: for the Worker Pool job
 * bound to the tab, or, on any other page, for the posting on screen (the tab is
 * remembered so Fill finds the résumé). A failure is reported, not fatal: the run
 * goes on and Fill attaches no résumé.
 */
export async function ensureRecommendedResume(args: {
  tabId: number;
  url: string;
  title: string;
  apiUrl: string;
  /** The page on screen is a job posting, so a Recommend can read the posting from it. */
  posting: boolean;
  log: RunLog;
}): Promise<{ recommended: boolean; error?: string }> {
  const { tabId, apiUrl, log } = args;
  if (await hasResume(tabId)) {
    log.event("recommend:skipped", { reason: "resume already assigned" });
    return { recommended: false };
  }
  const tabJob = await getTabJob(tabId);
  if (!tabJob && !args.posting) {
    log.event("recommend:skipped", { reason: "no job on this tab and the page is not a posting" });
    return { recommended: false };
  }
  try {
    if (tabJob) {
      log.event("recommend:start", { source: "job", jobId: tabJob.jobId });
      await runJobRecommend({ jobId: tabJob.jobId, tabId, apiUrl });
    } else {
      log.event("recommend:start", { source: "page" });
      await rememberCustomTab({
        tabId,
        url: args.url,
        title: args.title,
        resumeMode: "recommend",
      });
      await runCustomRecommend({ tabId, apiUrl });
    }
    const stack =
      (await getCustomTab(tabId))?.recommendedResumeStack ??
      (tabJob ? (await getJobGenerate(tabJob.jobId))?.recommendedResumeStack : null);
    log.event("recommend:done", { stack: stack ?? null });
    return { recommended: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.event("recommend:failed", { error });
    return { recommended: false, error };
  }
}
