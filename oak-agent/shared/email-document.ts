/**
 * The document an email is shown in. The iframe that holds it has no scripts and no
 * same-origin access, so the email's own styles run as they would in Gmail but nothing
 * it carries can act. Remote images are blocked until the person asks for them: loading
 * one tells the sender the email was opened.
 */

const CSP_BLOCKED = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
const CSP_IMAGES =
  "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:";

/** Gmail's reading surface: white paper, dark text. */
const PAGE_STYLE = [
  "html,body{margin:0;padding:0;background:#ffffff;color:#202124}",
  "body{padding:12px;font:14px/1.5 Arial,Helvetica,sans-serif;overflow-wrap:anywhere}",
  "img{max-width:100%;height:auto}",
  "table{max-width:100%}",
  "pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:0}",
].join("");

export type EmailBody = { html: string; text: string };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A page that redirects itself would leave the email; the sandbox stops scripts, not this. */
function withoutRefresh(html: string): string {
  return html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "");
}

/** Whether the email points at images on the web, so the person can be told some are blocked. */
export function hasRemoteImages(html: string): boolean {
  return (
    /<img\b[^>]*\bsrc\s*=\s*["']?\s*https?:/i.test(html) ||
    /\burl\(\s*["']?\s*https?:/i.test(html) ||
    /\bbackground\s*=\s*["']?\s*https?:/i.test(html)
  );
}

/** The `srcdoc` of an email: its HTML, else its text; links open in a new tab. */
export function buildEmailDocument(body: EmailBody, allowRemoteImages: boolean): string {
  const html = body.html.trim();
  const content = html
    ? withoutRefresh(html)
    : `<pre>${escapeHtml(body.text.trim() || "This email has no text.")}</pre>`;
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${allowRemoteImages ? CSP_IMAGES : CSP_BLOCKED}">` +
    '<base target="_blank">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<style>${PAGE_STYLE}</style></head><body>${content}</body></html>`
  );
}
