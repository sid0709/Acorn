import { customTabHasResume, getCustomTab, rememberCustomTab } from "../tab-custom-session";
import { getJobGenerate } from "../tab-job-generate-session";
import { getTabJob } from "../tab-job-session";

import { runCustomRecommend } from "./custom-recommend";
import { runJobRecommend } from "./job-recommend";
import { resumeGate, type ResumeGate } from "./resume-gate";

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
 * Choose a Library résumé for this tab when it has none: from the Worker Pool job
 * bound to the tab, or else from the page on screen (a posting, or a form that
 * carries the description; the SelectorGateway decides whether the text is a
 * posting at all). A run acts on the page only when this returns ok.
 */
export async function ensureRecommendedResume(args: {
  tabId: number;
  url: string;
  title: string;
  apiUrl: string;
  log: RunLog;
}): Promise<ResumeGate> {
  const { tabId, apiUrl, log } = args;
  if (await hasResume(tabId)) {
    log.event("recommend:skipped", { reason: "resume already assigned" });
    return resumeGate(true);
  }
  const tabJob = await getTabJob(tabId);
  let error: string | null = null;
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
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const gate = resumeGate(await hasResume(tabId), error);
  if (gate.ok) {
    const stack =
      (await getCustomTab(tabId))?.recommendedResumeStack ??
      (tabJob ? (await getJobGenerate(tabJob.jobId))?.recommendedResumeStack : null);
    log.event("recommend:done", { stack: stack ?? null });
  } else {
    log.event("recommend:failed", { error: gate.reason });
  }
  return gate;
}
