/** Query parameters the support landing page reads. */
export const SUPPORT_PARAM = { extensionCode: "ext", error: "error" } as const;

/** How long the page waits for the extension to answer before saying it is not installed. */
export const EXTENSION_ACK_TIMEOUT_MS = 4000;
