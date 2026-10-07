/**
 * Where Acorn's clients find their servers. Every route lives under `/acorn` on the
 * API, and so does the Socket.IO gateway. A build overrides either host with
 * VITE_ACORN_API_URL / VITE_ACORN_WEB_URL.
 */

/** Engine.IO path of Acorn's Socket.IO gateway, on the API host. */
export const ACORN_SOCKET_PATH = "/acorn/socket.io";

/** Cookie acorn-frontend sets. The API accepts that value as a bearer token. */
export const ACORN_SESSION_COOKIE = "acorn_session";

export type AcornHosts = {
  /** acorn-backend. Routes and the socket both live under `/acorn` on this origin. */
  api: string;
  /** acorn-frontend, where a new Gmail creates an Acorn account. */
  web: string;
};

/** Development builds talk to the local servers (`bun run dev`); every other build to production. */
export const ACORN_HOSTS = {
  development: { api: "http://127.0.0.1:8083", web: "http://localhost:6005" },
  production: { api: "https://acornapi.remotepairnet.net", web: "https://acorn.remotepairnet.net" },
} as const satisfies Record<string, AcornHosts>;

/** The hosts for a Vite build mode (`import.meta.env.MODE`). */
export function acornHosts(mode: string): AcornHosts {
  return mode === "development" ? ACORN_HOSTS.development : ACORN_HOSTS.production;
}

/**
 * Names the caller on every API request as "<client>/<version>", so usage stats can
 * tell the extension from the site. The same string is clientHeader in acornapi.
 */
export const ACORN_CLIENT_HEADER = "X-Acorn-Client";
export const ACORN_CLIENT = { extension: "extension", web: "web" } as const;

/**
 * Support sign-in between acorn-frontend and the extension, over window.postMessage
 * on the Acorn site (the extension's content script relays to its service worker):
 * - the page posts ACORN_EXTENSION_PING; the extension answers ACORN_EXTENSION_HELLO
 *   with whom it is signed in as;
 * - when that is not the page's support session, the page posts ACORN_SUPPORT_HANDOFF
 *   with a one-time code; the extension answers ACORN_SUPPORT_HANDOFF_ACK.
 */
export const ACORN_EXTENSION_PING = "acorn:extension-ping";
export const ACORN_EXTENSION_HELLO = "acorn:extension-hello";
export const ACORN_SUPPORT_HANDOFF = "acorn:support-handoff";
export const ACORN_SUPPORT_HANDOFF_ACK = "acorn:support-handoff-ack";
export type AcornExtensionHello = {
  type: typeof ACORN_EXTENSION_HELLO;
  /** The signed-in account, or "" when the extension is signed out. */
  accountId: string;
  /** The admin when the extension is in a support session, else "". */
  supportBy: string;
};
export type AcornSupportHandoffMessage = { type: typeof ACORN_SUPPORT_HANDOFF; code: string };
export type AcornSupportHandoffAck = {
  type: typeof ACORN_SUPPORT_HANDOFF_ACK;
  ok: boolean;
  error?: string;
};

/** Where a support handoff code is redeemed on the API. */
export const ACORN_SUPPORT_REDEEM_PATH = "/acorn/auth/support/redeem";
/** Where a support session asks for a fresh code for the extension. */
export const ACORN_SUPPORT_EXTENSION_CODE_PATH = "/acorn/auth/support/extension-code";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1"];

/**
 * Every origin the Acorn site runs on: development, production, and any override,
 * with localhost and 127.0.0.1 treated as the same machine. Only these may hand
 * the extension a support sign-in.
 */
export function acornWebOrigins(extra: string[] = []): string[] {
  const origins = new Set<string>();
  for (const raw of [...Object.values(ACORN_HOSTS).map((h) => h.web), ...extra]) {
    try {
      const url = new URL(raw);
      origins.add(url.origin);
      if (LOOPBACK_HOSTS.includes(url.hostname)) {
        for (const host of LOOPBACK_HOSTS) {
          origins.add(`${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`);
        }
      }
    } catch {
      /* not a URL */
    }
  }
  return [...origins];
}
