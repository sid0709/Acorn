/** chrome.storage.local keys of the Acorn sign-in. */
export const STORAGE_KEYS = {
  apiUrl: "acornApiUrl",
  session: "acornSession",
  /** The person's own session, kept while a support session stands in for it. */
  sessionBeforeSupport: "acornSessionBeforeSupport",
} as const;
