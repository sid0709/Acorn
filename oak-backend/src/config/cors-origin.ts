const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\//i;

/** Whether a browser/extension Origin may call the API. */
export function isAllowedCorsOrigin(
  requestOrigin: string | undefined,
  corsOrigins: readonly string[],
): boolean {
  if (!requestOrigin) return true;
  if (corsOrigins.length === 0 || corsOrigins.includes('*')) return true;
  if (CHROME_EXTENSION_ORIGIN.test(requestOrigin)) return true;
  return corsOrigins.includes(requestOrigin);
}

/**
 * Nest CORS origin delegate. `*` or an empty list reflects any origin
 * (required when credentials are enabled). Chrome extension IDs are always
 * allowed so Athens Lens is not blocked by a web-only CORS_ORIGIN list.
 */
export function corsOriginDelegate(corsOrigins: readonly string[]) {
  return (
    requestOrigin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    callback(null, isAllowedCorsOrigin(requestOrigin, corsOrigins));
  };
}
