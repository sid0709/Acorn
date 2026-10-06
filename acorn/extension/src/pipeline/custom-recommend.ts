import { getCustomTab, patchCustomTab } from "../tab-custom-session";
import { readRememberedTabPosting } from "./custom-page-jd";
import { runResumeRecommend } from "./run-recommend";

export async function runCustomRecommend(args: {
  tabId: number;
  apiUrl: string;
  continue?: boolean;
}): Promise<void> {
  const { tabId, apiUrl } = args;
  await runResumeRecommend({
    source: "custom",
    apiUrl,
    tabId,
    continue: Boolean(args.continue),
    loadJd: () => readRememberedTabPosting(tabId),
    store: {
      patch: async (partial) => {
        await patchCustomTab(tabId, partial);
      },
      readCheckpoint: async () => {
        const tab = await getCustomTab(tabId);
        return tab?.checkpoint ?? null;
      },
      readStatus: async () => {
        const tab = await getCustomTab(tabId);
        return tab?.generateStatus ?? null;
      },
      complete: async (result) => {
        await patchCustomTab(tabId, {
          recommendedResumeId: result.recommendedResumeId,
          recommendedResumeStack: result.recommendedResumeStack,
          recommendedResumeReason: result.recommendedResumeReason,
          recommendedTop: result.recommendedTop,
          generateStatus: "completed",
          generateError: null,
          generateProgress: null,
          checkpoint: result.checkpoint,
          jobDescription: result.jobDescription,
        });
      },
    },
  });
}
