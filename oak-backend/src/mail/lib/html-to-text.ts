/** Convert email HTML to readable plain text (block structure preserved). */
export function htmlToStructuredText(html: string): string {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(
      /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, inner: string) => {
        const label = String(inner)
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const url = String(href || '').trim();
        if (!url) return label;
        if (!label || label === url) return url;
        return `${label}\n${url}`;
      },
    )
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#?[a-z0-9]+;/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Prefer the plain source that keeps more readable structure.
 * When text/plain is a single flattened line, HTML conversion often wins.
 */
export function preferReadablePlain(
  bodyText: string,
  bodyHtml: string | null | undefined,
): string {
  const fromText = String(bodyText || '').trim();
  const html = String(bodyHtml || '').trim();
  if (!html) return fromText;
  const fromHtml = htmlToStructuredText(html);
  if (!fromHtml) return fromText;
  if (!fromText) return fromHtml;
  const textBreaks = (fromText.match(/\n/g) || []).length;
  const htmlBreaks = (fromHtml.match(/\n/g) || []).length;
  if (htmlBreaks > textBreaks) return fromHtml;
  return fromText;
}
