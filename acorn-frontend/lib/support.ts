/** Query parameters the support landing page reads. */
export const SUPPORT_PARAM = { extensionCode: "ext", error: "error" } as const;

/** How long the page waits for the extension to answer before saying it is not installed. */
export const EXTENSION_ACK_TIMEOUT_MS = 8000;

/** How often the page repeats the code until the extension's content script answers. */
export const EXTENSION_HANDOFF_RETRY_MS = 500;

/** How long the extension's code works; supportaccess.HandoffTTL in acorn-backend. */
export const EXTENSION_CODE_TTL_MINUTES = 2;
