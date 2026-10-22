/** GCS resumable sessions are bound to one CORS origin. */
export function resumableUploadOrigin(raw?: string): string | undefined {
  const origin = String(raw || process.env.UPLOAD_CORS_ORIGIN || '')
    .trim()
    .replace(/\/+$/, '');
  if (!origin) return undefined;
  if (/^chrome-extension:\/\/[a-z0-9-]+$/i.test(origin)) return origin;
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:' || url.protocol === 'http:')
      return url.origin;
  } catch {
    return undefined;
  }
  return undefined;
}
