/** Compact pure-tree → visible page text for Custom résumé generation. */

export type ExtractableNode = {
  tag: string;
  text?: string;
  children: ExtractableNode[];
};

export const PAGE_TEXT_MAX_CHARS = 20_000;

const SKIP_TAGS = new Set([
  'input',
  'select',
  'textarea',
  'button',
  'option',
  'script',
  'style',
  'noscript',
]);

export function extractVisiblePageText(
  pure: ExtractableNode | null | undefined,
  ctx?: { title?: string; url?: string },
): string {
  const chunks: string[] = [];
  if (pure) walk(pure, chunks);
  const body = collapseWhitespace(chunks.join(' '));
  if (!body) return '';

  const parts: string[] = [];
  const title = String(ctx?.title ?? '').trim();
  const url = String(ctx?.url ?? '').trim();
  if (title) parts.push(title);
  if (url) parts.push(url);
  parts.push(body);
  return parts.join('\n\n').slice(0, PAGE_TEXT_MAX_CHARS);
}

function walk(node: ExtractableNode, chunks: string[]): void {
  const tag = String(node.tag || '').toLowerCase();
  if (SKIP_TAGS.has(tag)) return;
  const text = String(node.text || '').trim();
  if (text) chunks.push(text);
  for (const child of node.children || []) walk(child, chunks);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
