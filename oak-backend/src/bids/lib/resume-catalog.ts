/** Strip .pdf / .docx so "C# + Java.docx" can match "C# + Java". */
export function stripResumeExtension(name: string): string {
  return String(name ?? '')
    .replace(/\.(pdf|docx)$/i, '')
    .trim();
}

export function normalizeResumeLabel(name: string): string {
  return stripResumeExtension(name)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compare upload filename to recommended stack label. */
export function matchUploadToRecommended(
  originalName: string | null | undefined,
  recommendedName: string | null | undefined,
): 'match' | 'mismatch' | 'unknown' {
  if (!originalName?.trim() || !recommendedName?.trim()) return 'unknown';
  const upload = normalizeResumeLabel(originalName);
  const recommended = normalizeResumeLabel(recommendedName);
  if (!upload || !recommended) return 'unknown';
  if (upload === recommended) return 'match';
  if (upload.includes(recommended) || recommended.includes(upload))
    return 'match';
  return 'mismatch';
}

function skillNamesFromCatalogEntry(entry: unknown): string[] {
  if (Array.isArray(entry)) {
    return entry
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (
          item &&
          typeof item === 'object' &&
          typeof (item as { name?: string }).name === 'string'
        ) {
          return String((item as { name: string }).name).trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  if (entry && typeof entry === 'object') {
    return Object.keys(entry)
      .map((k) => String(k).trim())
      .filter(Boolean);
  }
  return [];
}

export function compressResumeCatalog(catalog: unknown): {
  text: string;
  stackNames: string[];
} {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return { text: '', stackNames: [] };
  }
  const stackNames = Object.keys(catalog).filter((k) => String(k).trim());
  const blocks = stackNames.map((stack) => {
    const skills = skillNamesFromCatalogEntry(
      (catalog as Record<string, unknown>)[stack],
    );
    const skillLine = skills.length ? skills.join(', ') : '(none)';
    return `Resume: ${stack}\nSkills: ${skillLine}`;
  });
  return { text: blocks.join('\n----\n'), stackNames };
}

export function resolveCatalogKey(
  recommended: string | null | undefined,
  stackNames: string[],
): string | null {
  const label = String(recommended ?? '').trim();
  if (!label || !stackNames.length) return null;
  const normalized = normalizeResumeLabel(label);
  if (!normalized) return null;
  for (const key of stackNames) {
    if (normalizeResumeLabel(key) === normalized) return key;
  }
  for (const key of stackNames) {
    const keyNorm = normalizeResumeLabel(key);
    if (keyNorm.includes(normalized) || normalized.includes(keyNorm))
      return key;
  }
  return null;
}
