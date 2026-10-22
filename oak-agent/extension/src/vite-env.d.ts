/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of oak-backend the side panel signs in to when none is saved. */
  readonly VITE_OAK_API_URL?: string;
  /** Oak's version, from extension/package.json (set by vite.config.ts). */
  readonly VITE_OAK_VERSION: string;
}
