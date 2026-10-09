import { getJobGenerate } from "../tab-job-generate-session";

import { requestCoverLetter } from "./api/cover-letter";
import { fetchStoredJobDescription } from "./api/job-files";

import type { AcornCustomTabBinding } from "../tab-custom-session";
import type { AcornTabJobBinding } from "../tab-job-session";
import type { RuntimeAttachedFile } from "@acorn/shared/plan-runner/types";

/** How much of the page stands in for the posting when no job description is stored. */
const COVER_LETTER_PAGE_TEXT_MAX = 8_000;

/**
 * The posting a cover letter is chosen for: the job description already stored
 * for this tab's job or remembered tab, else the page itself.
 */
async function postingText(input: {
  customTab: AcornCustomTabBinding | null;
  tabJob: AcornTabJobBinding | null;
  pageText: string;
  apiUrl: string;
}): Promise<string> {
  const remembered = String(input.customTab?.jobDescription || "").trim();
  if (remembered) return remembered;
  if (input.tabJob?.jobId) {
    const generated = String(
      (await getJobGenerate(input.tabJob.jobId))?.jobDescription || "",
    ).trim();
    if (generated) return generated;
    const stored = await fetchStoredJobDescription(input.tabJob.jobId, input.apiUrl).catch(
      () => "",
    );
    if (stored.trim()) return stored.trim();
  }
  return input.pageText.slice(0, COVER_LETTER_PAGE_TEXT_MAX);
}

/**
 * The Library cover letter for this application, fetched only when the plan
 * uploads one. Null when the Library holds none: the field is left to the page.
 */
export async function loadCoverLetter(input: {
  tabId: number;
  customTab: AcornCustomTabBinding | null;
  tabJob: AcornTabJobBinding | null;
  pageText: string;
  apiUrl: string;
}): Promise<RuntimeAttachedFile | null> {
  const posting = await postingText(input);
  const choice = await requestCoverLetter(posting, input.apiUrl, input.tabId);
  return choice.file;
}
