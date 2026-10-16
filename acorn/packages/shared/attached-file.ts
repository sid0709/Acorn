/** A résumé or cover-letter file as the API returns it, ready to attach. */

export interface RuntimeAttachedFile {
  key: string;
  name: string;
  mimeType: string;
  base64: string;
  /** Library stack label for UI (e.g. folder title). */
  label?: string | null;
  /** Library row id assigned to this job. */
  resumeId?: string | null;
  /** Worker pool job this file was fetched for. */
  jobId?: string | null;
  /** The file's format: pdf, docx, doc, or txt. */
  format?: string | null;
  /** resume or cover_letter. */
  kind?: string | null;
  /**
   * The same stack in its other formats, preferred first. An upload field that
   * takes only one format gets that one; the file itself is the preferred one.
   */
  variants?: RuntimeAttachedFile[];
}
