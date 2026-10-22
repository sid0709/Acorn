const STORAGE_UNAVAILABLE =
  'Athens storage is unavailable right now. Your recording is still saved in Lens — try Yes, submitted again shortly.';

const GENERIC_BEGIN =
  'Could not start the recording upload. Storage did not return an upload URL.';

export function compactStorageError(error: unknown, max = 240): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  return raw.length <= max ? raw : `${raw.slice(0, max)}…`;
}

/** User-facing begin() failure. Billing outages are not an upload-URL bug. */
export function beginUploadFailureMessage(error: unknown): string {
  const raw = compactStorageError(error, 800);
  if (/billing account|accountDisabled|state delinquent/i.test(raw)) {
    return STORAGE_UNAVAILABLE;
  }
  return GENERIC_BEGIN;
}
