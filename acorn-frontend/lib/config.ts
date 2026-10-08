/** Local acorn-backend. Override with ACORN_API_URL. */
const DEFAULT_API_URL = "http://127.0.0.1:8083";

/** Local acorn-frontend. Production sets ACORN_WEB_URL to the public origin. */
const DEFAULT_WEB_URL = "http://localhost:6005";

export const BRAND = "Acorn";

/** The public origin: canonical links, the sitemap, and social cards resolve against it. */
export function siteUrl(): string {
  return (process.env.ACORN_WEB_URL || DEFAULT_WEB_URL).replace(/\/$/, "");
}

export function acornApiUrl(): string {
  return (process.env.ACORN_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
}

/** Packed Chrome extension served from the website image after deploy. */
export const EXTENSION_DOWNLOAD_PATH = "/downloads/acorn-chrome.zip";

/** Chrome Web Store or sideload URL. Empty until a listing exists. */
export function extensionInstallUrl(): string | null {
  const url = process.env.ACORN_EXTENSION_INSTALL_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

/** Version baked into the website image when the extension is built in CI/CD. */
export function extensionVersion(): string | null {
  const version = process.env.NEXT_PUBLIC_ACORN_EXTENSION_VERSION?.trim();
  return version || null;
}

/** A packed build (.zip) for sideloading while there is no store listing. */
export function extensionDownloadUrl(): string | null {
  const override = process.env.ACORN_EXTENSION_DOWNLOAD_URL?.trim();
  if (override) return override;
  if (extensionVersion()) return EXTENSION_DOWNLOAD_PATH;
  // Website Docker images always run extension-release before `next build`.
  if (process.env.NODE_ENV === "production") return EXTENSION_DOWNLOAD_PATH;
  return null;
}

/** Gmail on the web, for "Open in Gmail". */
export const GMAIL_WEB_URL = "https://mail.google.com/mail";

/** A message in Gmail on the web, opened as the account that received it. */
export function gmailWebLink(accountEmail: string, messageId: string) {
  return `${GMAIL_WEB_URL}/u/${encodeURIComponent(accountEmail)}/#all/${encodeURIComponent(messageId)}`;
}
