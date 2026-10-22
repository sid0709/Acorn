/** Collections of Acorn's database (`acorn-backend`), the only data store Oak reads and writes. */
export const ACORN_ACCOUNTS_COLLECTION = 'acorn_accounts';
export const ACORN_SESSIONS_COLLECTION = 'acorn_sessions';
export const ACORN_PROFILES_COLLECTION = 'acorn_profiles';
export const ACORN_LIBRARY_COLLECTION = 'acorn_resume_library';
export const ACORN_AI_USAGE_COLLECTION = 'acorn_ai_usage';

/** `LibraryRow.kind` of a résumé; rows saved before kinds have none. */
export const ACORN_LIBRARY_KIND_RESUME = 'resume';

/** Acorn's extension sign-in and sign-out routes. Sign-in checks the extension password. */
export const ACORN_SIGNIN_PATH = '/acorn/auth/extension/signin';
export const ACORN_SIGNOUT_PATH = '/acorn/auth/signout';

/** Acorn caches a checked session for the same span (account.sessionCache). */
export const ACORN_SESSION_CACHE_MS = 30_000;
export const ACORN_API_TIMEOUT_MS = 10_000;

const DEFAULT_DB = 'AcornDB';
const DEFAULT_API_URL = 'http://127.0.0.1:8083';

/** Profile fields that never reach a prompt. */
export const ACORN_PROFILE_SECRET_FIELDS = [
  'openrouterApiKey',
  'openaiApiKey',
  'defaultAccountPassword',
  'extensionPassword',
  'resumeFolderPath',
] as const;

export function acornMongoUri(): string {
  const uri = process.env.ACORN_MONGO_URI?.trim();
  if (!uri) throw new Error('ACORN_MONGO_URI is required');
  return uri;
}

export function acornDbName(): string {
  return process.env.ACORN_DB?.trim() || DEFAULT_DB;
}

export function acornApiUrl(): string {
  return (process.env.ACORN_API_URL?.trim() || DEFAULT_API_URL).replace(
    /\/+$/,
    '',
  );
}
