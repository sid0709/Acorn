import type { RuntimeAttachedFile } from "../../../shared/plan-runner/types";
import { pageHasResume, type OakPageBinding } from "../tab-page-session";
import { fetchLibraryResume } from "./ai-client";

/** The file key the planner's resume_upload step reads. */
const RECOMMENDED_RESUME_KEY = "recommended_resume";

const NO_LIBRARY_RESUME = "No résumé in your Acorn Library";

/**
 * The résumé Fill uploads: the one a JD shot picked for this page, else the account's primary
 * Library résumé (`primary`, already fetched for the runtime file).
 */
export async function loadFillResume(input: {
  page: OakPageBinding | null;
  primary: RuntimeAttachedFile | null;
  apiUrl: string;
}): Promise<{ file: RuntimeAttachedFile | null; skipReason: string | null }> {
  const { page, primary, apiUrl } = input;
  if (page && pageHasResume(page)) {
    try {
      const file = await fetchLibraryResume(String(page.resumeId), apiUrl);
      if (!file) {
        return { file: null, skipReason: "Could not load the picked Library résumé" };
      }
      return { file, skipReason: null };
    } catch (err) {
      return {
        file: null,
        skipReason: err instanceof Error ? err.message : String(err),
      };
    }
  }
  if (!primary) return { file: null, skipReason: NO_LIBRARY_RESUME };
  return { file: { ...primary, key: RECOMMENDED_RESUME_KEY }, skipReason: null };
}
