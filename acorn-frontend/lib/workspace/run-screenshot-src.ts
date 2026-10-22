/** The browser reads a Run's image from this site; the route adds the session. */
export function runScreenshotSrc(id: string): string {
  return `/api/runs/${encodeURIComponent(id)}/screenshot`;
}
