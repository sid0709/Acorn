/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Acorn's version, from extension/package.json (injected by vite.config.ts). */
  readonly VITE_ACORN_VERSION: string;
  readonly VITE_ACORN_API_URL?: string;
  readonly VITE_ACORN_WEB_URL?: string;
  /** "true" turns on local debug capture (see acorn/.env.example). */
  readonly VITE_ACORN_DEBUG?: string;
  /** Seconds Auto-Focus keeps each run tab in front (see acorn/.env.example). */
  readonly VITE_ACORN_AUTO_FOCUS_SECONDS?: string;
}
