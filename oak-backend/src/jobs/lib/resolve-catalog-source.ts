import { inferJobSource } from './infer-job-source';

/**
 * Catalog `source` from apply/job URL host.
 * Used by Title Review / AI Analyze so LI-scrapper can keep sending
 * `source: "linkedin"` without permanently mislabeling ATS offsites.
 */
export function resolveCatalogSource(
  applyLink: string | null | undefined,
): string {
  return inferJobSource(applyLink);
}
