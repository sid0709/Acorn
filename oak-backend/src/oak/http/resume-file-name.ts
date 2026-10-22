/** Characters no file name may hold on Windows or macOS. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
const UNSAFE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;
const MAX_STEM_LENGTH = 100;
/** Used when neither the file nor the profile gives an extension. */
const FALLBACK_EXTENSION = '.pdf';

function basename(name: string): string {
  return String(name || '')
    .split(/[\\/]/)
    .pop()!
    .trim();
}

function extensionOf(name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * The name a résumé is uploaded under: the profile's name with the file's own
 * extension (Backend.pdf → Eli Taylor.pdf, Frontend.docx → Eli Taylor.docx).
 * The recruiter sees the person, and anyone checking an upload can tell the
 * right file went in from the profile name plus its type. Same rule as Athens
 * Lens' buildSubmittedFileName. With no profile name the file keeps its name.
 */
export function resumeUploadName(
  profileName: string,
  originalName: string,
): string {
  const stem = String(profileName || '')
    .replace(UNSAFE_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_STEM_LENGTH)
    .trim();
  if (!stem) return basename(originalName);
  return `${stem}${extensionOf(originalName) || FALLBACK_EXTENSION}`;
}
