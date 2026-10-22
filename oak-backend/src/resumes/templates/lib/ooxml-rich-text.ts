export function xmlEscape(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function splitMarkdownSegments(
  text: unknown,
): { text: string; bold: boolean }[] {
  const parts = String(text ?? '').split(/(\*\*[^*]+?\*\*)/g);
  return parts
    .filter((p) => p.length > 0)
    .map((p) => {
      const bold = /^\*\*[^*]+?\*\*$/.test(p);
      return { text: bold ? p.slice(2, -2) : p, bold };
    });
}

function runText(runXml: string): string {
  const texts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(runXml)) !== null) texts.push(m[1]);
  return texts.join('');
}

function extractRPr(runXml: string): string {
  const m = runXml.match(/<w:rPr[\s\S]*?<\/w:rPr>/);
  return m ? m[0] : '';
}

function withBold(rPr: string): string {
  if (!rPr) return '<w:rPr><w:b/></w:rPr>';
  if (/<w:b\b/.test(rPr)) return rPr;
  return rPr.replace('</w:rPr>', '<w:b/></w:rPr>');
}

function textNode(text: string): string {
  const escaped = xmlEscape(text);
  const preserve = /^\s|\s$/.test(escaped) ? ' xml:space="preserve"' : '';
  return `<w:t${preserve}>${escaped}</w:t>`;
}

export function buildRunsXml(
  baseRPr: string,
  segments: { text: string; bold: boolean }[],
): string {
  return segments
    .map((seg) => {
      if (!seg.text) return '';
      const rPr = seg.bold ? withBold(baseRPr) : baseRPr;
      return `<w:r>${rPr}${textNode(seg.text)}</w:r>`;
    })
    .filter(Boolean)
    .join('');
}

function replaceRunPlaceholder(
  runXml: string,
  markdownText: string,
  placeholder: string,
): string | null {
  const combined = runText(runXml);
  if (!combined.includes(placeholder)) return null;

  const baseRPr = extractRPr(runXml);
  const segments = splitMarkdownSegments(markdownText);
  const outSegs = segments.length ? segments : [{ text: '', bold: false }];

  if (combined === placeholder) return buildRunsXml(baseRPr, outSegs);

  const at = combined.indexOf(placeholder);
  if (at < 0) return null;
  const before = combined.slice(0, at);
  const after = combined.slice(at + placeholder.length);
  const out: { text: string; bold: boolean }[] = [];
  if (before) out.push({ text: before, bold: false });
  out.push(...outSegs);
  if (after) out.push({ text: after, bold: false });
  return buildRunsXml(baseRPr, out);
}

const RUN_RE = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
const T_RE = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;

function concatT(paraXml: string): string {
  T_RE.lastIndex = 0;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = T_RE.exec(paraXml)) !== null) parts.push(m[1]);
  return parts.join('');
}

/** Merge only the w:t nodes that cover `placeholder` so split `{token}` becomes one run. */
function coalescePlaceholder(paraXml: string, placeholder: string): string {
  const tNodes = [...paraXml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)];
  if (tNodes.length < 2) return paraXml;
  const full = tNodes.map((n) => n[1]).join('');
  const at = full.indexOf(placeholder);
  if (at < 0) return paraXml;
  const end = at + placeholder.length;
  let pos = 0;
  let first = -1;
  let last = -1;
  tNodes.forEach((n, i) => {
    const start = pos;
    pos += n[1].length;
    if (pos > at && start < end) {
      if (first < 0) first = i;
      last = i;
    }
  });
  if (first < 0 || first === last) return paraXml;
  const joined = tNodes
    .slice(first, last + 1)
    .map((n) => n[1])
    .join('');
  let i = 0;
  return paraXml.replace(
    /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g,
    (fullMatch, attrs: string, text: string) => {
      const idx = i;
      i += 1;
      if (idx < first || idx > last) return fullMatch;
      if (idx === first) {
        const preserve = /^\s|\s$/.test(joined) ? ' xml:space="preserve"' : '';
        return `<w:t${attrs || preserve}>${joined}</w:t>`;
      }
      return `<w:t xml:space="preserve"></w:t>`;
    },
  );
}

/** Replace `{}` or `{token}` in a paragraph with markdown-aware OOXML runs. */
export function replacePlaceholderWithRichText(
  paraXml: string,
  markdownText: string,
  placeholder = '{}',
): string {
  if (!paraXml) return paraXml;
  const needle = placeholder || '{}';
  let xml = paraXml;
  const runHasNeedle = (): boolean => {
    RUN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RUN_RE.exec(xml)) !== null) {
      if (runText(m[0]).includes(needle)) return true;
    }
    return false;
  };
  if (concatT(xml).includes(needle) && !runHasNeedle()) {
    xml = coalescePlaceholder(xml, needle);
  }
  if (!concatT(xml).includes(needle)) return paraXml;
  if (!runHasNeedle()) {
    xml = coalescePlaceholder(xml, needle);
  }

  RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUN_RE.exec(xml)) !== null) {
    const replacement = replaceRunPlaceholder(m[0], markdownText ?? '', needle);
    if (!replacement) continue;
    return (
      xml.slice(0, m.index) + replacement + xml.slice(m.index + m[0].length)
    );
  }

  return paraXml;
}

export function cloneParaWithRichText(
  paraXml: string,
  markdownText: string,
  placeholder = '{}',
): string {
  return replacePlaceholderWithRichText(paraXml, markdownText, placeholder);
}
