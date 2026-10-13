/** Remembers successful uploads by acorn node id after the file input is remounted away. */

const uploadedByAcornId = new Map<string, string>();
/** Files handed to a file input in this document, whether or not the page showed them yet. */
let filesSent = 0;

export function rememberUploadedFile(acornId: string | null | undefined, fileName: string): void {
  if (!acornId || !fileName) return;
  uploadedByAcornId.set(String(acornId), fileName);
}

/** A file was handed to a file input: the page's own upload may take a while to show it. */
export function rememberFileSent(): void {
  filesSent += 1;
}

/**
 * Some file went up through this document already (a résumé, a cover letter), or
 * was sent and the page has not shown it yet: a later pass never sends the résumé
 * again into another file field (a profile import that rewrites the form).
 */
export function uploadedAny(): boolean {
  return uploadedByAcornId.size > 0 || filesSent > 0;
}

export function getRememberedUpload(acornId: number | string): string | null {
  return uploadedByAcornId.get(String(acornId)) ?? null;
}

export function pageMentionsFilename(doc: Document, name: string): boolean {
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
  if ((doc.body?.innerText || "").toLowerCase().includes(needle)) return true;

  for (const node of Array.from(doc.querySelectorAll("a, span, div, p, li, button"))) {
    const text = ((node as HTMLElement).innerText || node.textContent || "").trim();
    if (!text) continue;
    if (text.toLowerCase() === needle || text.toLowerCase().includes(needle)) {
      if ((node as HTMLElement).getClientRects().length > 0) return true;
    }
  }
  return false;
}
