/** True when a library row points at a Word binary (not a text extract). */
export function isDocxRow(row: {
  mimeType?: string | null;
  storagePath?: string | null;
  fileName?: string | null;
}): boolean {
  const mime = String(row.mimeType || '').toLowerCase();
  const path = String(row.storagePath || '').toLowerCase();
  const name = String(row.fileName || '').toLowerCase();
  return (
    mime.includes('wordprocessing') ||
    path.endsWith('.docx') ||
    name.endsWith('.docx')
  );
}
