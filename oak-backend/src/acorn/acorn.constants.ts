/** Collections of Acorn's database (`acorn-backend`), the only data store Oak reads and writes. */
export const ACORN_ACCOUNTS_COLLECTION = 'acorn_accounts';
export const ACORN_SESSIONS_COLLECTION = 'acorn_sessions';
export const ACORN_PROFILES_COLLECTION = 'acorn_profiles';
export const ACORN_LIBRARY_COLLECTION = 'acorn_resume_library';
export const ACORN_AI_USAGE_COLLECTION = 'acorn_ai_usage';

/** `LibraryRow.kind` of a résumé; rows saved before kinds have none. */
export const ACORN_LIBRARY_KIND_RESUME = 'resume';

/** Headers every Acorn client sends: the Chrome tab it works for and who it is ("oak/1.2.3"). */
export const ACORN_TAB_HEADER = 'x-acorn-tab';
export const ACORN_CLIENT_HEADER = 'x-acorn-client';
export const ACORN_TAB_HEADER_NAME = 'X-Acorn-Tab';
export const ACORN_CLIENT_HEADER_NAME = 'X-Acorn-Client';
/** Same bounds as acorn-backend's tabKey() and clientFrom(). */
export const ACORN_TAB_KEY_MIN = 8;
export const ACORN_TAB_KEY_MAX = 64;
export const ACORN_CLIENT_NAME_MAX = 16;
export const ACORN_CLIENT_VERSION_MAX = 32;
/** `client` stamped on Oak's usage rows. */
export const OAK_CLIENT = 'oak';

/** Acorn routes Oak forwards to, with the caller's own session token. */
export const ACORN_RECOMMEND_PATH = '/acorn/custom/recommend';
export const ACORN_RUNS_PATH = '/acorn/runs';
/** Mail the Gmail watcher labelled as a verification email, across the account's mailboxes. */
export const ACORN_VERIFY_MAIL_PATH = '/acorn/gmail/verify-mail';
export const ACORN_RUN_SCREENSHOT_SUFFIX = 'screenshot';
/** acorn-backend's cap on one run screenshot (config.MaxRunScreenshotBytes). */
export const ACORN_RUN_SCREENSHOT_MAX_BYTES = 6 * 1024 * 1024;

/** Acorn's extension sign-in and sign-out routes. Sign-in checks the extension password. */
export const ACORN_SIGNIN_PATH = '/acorn/auth/extension/signin';
export const ACORN_SIGNOUT_PATH = '/acorn/auth/signout';

/** Acorn caches a checked session for the same span (account.sessionCache). */
export const ACORN_SESSION_CACHE_MS = 30_000;
export const ACORN_API_TIMEOUT_MS = 10_000;
/** Recommend runs a model call; give it longer than a plain read. */
export const ACORN_RECOMMEND_TIMEOUT_MS = 60_000;
/** A full-page screenshot upload. */
export const ACORN_UPLOAD_TIMEOUT_MS = 30_000;
export const NANOS_PER_USD = 1e9;

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
