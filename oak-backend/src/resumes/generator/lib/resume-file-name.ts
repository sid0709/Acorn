/** Download name from the résumé identity: keep the full name, including spaces. */
export function resumeDownloadFileName(fullName: unknown): string {
  const base = String(fullName ?? '').trim() || 'resume';
  const safe =
    base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'resume';
  return safe.toLowerCase().endsWith('.docx') ? safe : `${safe}.docx`;
}

export function contentDispositionAttachment(fileName: string): string {
  const quoted = fileName.replace(/["\\\r\n]/g, '_');
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${quoted}"; filename*=UTF-8''${encoded}`;
}
