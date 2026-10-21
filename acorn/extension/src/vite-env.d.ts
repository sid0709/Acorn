/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Acorn's version, from extension/package.json (injected by vite.config.ts). */
  readonly VITE_ACORN_VERSION: string;
  readonly VITE_ACORN_API_URL?: string;
  readonly VITE_ACORN_WEB_URL?: string;
  /** Where acorn-agent runs; defaults to this machine (see @acorn/shared acornHosts). */
  readonly VITE_ACORN_AGENT_URL?: string;
  /** "true" turns on local debug capture (see acorn/.env.example). */
  readonly VITE_ACORN_DEBUG?: string;
  /** "true" makes runs fast-fill runs by default (see acorn/.env.example). */
  readonly VITE_ACORN_AGENT_FAST_FILL?: string;
  /** "true" lets runs survey long pages by default (see acorn/.env.example). */
  readonly VITE_ACORN_AGENT_SURVEY?: string;
}
