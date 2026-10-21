/**
 * Pages outside the extension that a notice's button opens: the person's Acorn profile and résumé Library
 * on acorn-frontend (the same paths as its routes), and the OpenRouter page where credits are added.
 */

/** acorn-frontend routes a notice can open. */
export const ACORN_WEB_PATH = {
  profile: "/profile",
  resumeLibrary: "/resume/library",
} as const;

export type AcornWebPath = (typeof ACORN_WEB_PATH)[keyof typeof ACORN_WEB_PATH];

/** Where OpenRouter takes credits for the person's own key. */
export const OPENROUTER_CREDITS_URL = "https://openrouter.ai/settings/credits";

/** The address of an acorn-frontend page on the given web origin. */
export function acornWebUrl(webOrigin: string, path: AcornWebPath): string {
  return `${webOrigin.replace(/\/$/, "")}${path}`;
}
