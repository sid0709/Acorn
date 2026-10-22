import {
  PAGE_TEXT_MAX_CHARS,
  extractVisiblePageText,
  type ExtractableNode,
} from './extract-page-text';

/**
 * Turn a Custom list-item `meta` field into extract-jd input text.
 * Strings pass through; DOM-like trees use visible-text extraction.
 */
export function metaToPageText(meta: unknown): string {
  if (meta == null) return '';
  if (typeof meta === 'string') {
    return meta.trim().slice(0, PAGE_TEXT_MAX_CHARS);
  }
  if (typeof meta === 'number' || typeof meta === 'boolean') {
    return String(meta).slice(0, PAGE_TEXT_MAX_CHARS);
  }
  if (Array.isArray(meta) || typeof meta !== 'object') {
    return stringifyCapped(meta);
  }
  const row = meta as Record<string, unknown>;
  if (typeof row.tag === 'string') {
    return extractVisiblePageText(asNode(row), {
      title: str(row.title),
      url: str(row.url),
    });
  }
  if (row.metaTree != null) return metaToPageText(row.metaTree);
  if (row.meta != null && row.meta !== meta) return metaToPageText(row.meta);
  if (typeof row.text === 'string' && !Array.isArray(row.children)) {
    return row.text.trim().slice(0, PAGE_TEXT_MAX_CHARS);
  }
  return stringifyCapped(row);
}

function asNode(row: Record<string, unknown>): ExtractableNode {
  const children = Array.isArray(row.children)
    ? row.children
        .filter((child) => child && typeof child === 'object')
        .map((child) => asNode(child as Record<string, unknown>))
    : [];
  return {
    tag: typeof row.tag === 'string' ? row.tag : '',
    text: typeof row.text === 'string' ? row.text : undefined,
    children,
  };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringifyCapped(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, PAGE_TEXT_MAX_CHARS);
  } catch {
    return '';
  }
}
