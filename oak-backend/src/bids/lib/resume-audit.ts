import { normalizeResumeLabel, stripResumeExtension } from './resume-catalog';

/** Profile-style expected resume filename (legacy contract). */
export function buildProfileResumeFileName(
  profileName: string,
  ext = '.pdf',
): string {
  const base = String(profileName || 'Resume')
    .trim()
    .replace(/[^\w\s.-]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  const suffix = ext.startsWith('.') ? ext : `.${ext}`;
  return `${base || 'Resume'}${suffix}`;
}

export function isResumeNameMismatch(
  actualName: string | null | undefined,
  expectedName: string | null | undefined,
): boolean {
  const a = normalizeResumeLabel(String(actualName || ''));
  const e = normalizeResumeLabel(String(expectedName || ''));
  if (!a || !e) return false;
  return a !== e;
}

export function resolveResumeOriginalName(input: {
  originalName?: string | null;
  cleanedName?: string | null;
}): string {
  const original = String(input.originalName || '').trim();
  if (original) return original;
  return String(input.cleanedName || '').trim();
}

export function resumeExtFromName(fileName: string): string {
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.docx')) return '.docx';
  if (name.endsWith('.doc')) return '.doc';
  return '.pdf';
}

export function cleanedResumeBase(name: string): string {
  return stripResumeExtension(name);
}
