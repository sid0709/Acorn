/** Parallelism for library bulk upload (Storage + text extract + Mongo). */
function envConcurrency(name: string, fallback: number): number {
  const n = Number.parseInt(String(process.env[name] ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(32, Math.floor(n));
}

export const RESUME_BULK_UPLOAD_CONCURRENCY = envConcurrency(
  'RESUME_BULK_UPLOAD_CONCURRENCY',
  8,
);
