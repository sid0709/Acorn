/** Decode MIME Content-Transfer-Encoding so IMAP body parts become readable text. */

const QP_SOFT_BREAK = /=(?:\r?\n|$)/g;
const QP_HEX = /=([0-9A-Fa-f]{2})/g;

export function decodeMimePartText(
  raw: string | Buffer,
  opts?: { encoding?: string; charset?: string },
): string {
  const source = Buffer.isBuffer(raw)
    ? raw.toString('latin1')
    : String(raw || '');
  if (!source.trim()) return '';

  const encoding = String(opts?.encoding || '')
    .toLowerCase()
    .replace(/_/g, '-')
    .trim();
  const charset = bufferEncoding(opts?.charset);

  if (encoding === 'base64') {
    return Buffer.from(source.replace(/\s+/g, ''), 'base64')
      .toString(charset)
      .trim();
  }

  if (
    encoding === 'quoted-printable' ||
    encoding === 'qp' ||
    looksLikeQuotedPrintable(source)
  ) {
    return decodeQuotedPrintable(source).toString(charset).trim();
  }

  return source.trim();
}

function looksLikeQuotedPrintable(value: string): boolean {
  return (value.match(/=(?:\r?\n)/g) || []).length >= 2;
}

function decodeQuotedPrintable(value: string): Buffer {
  const unfolded = value.replace(/[\t ]+$/gm, '').replace(QP_SOFT_BREAK, '');
  const bytes: number[] = [];
  let last = 0;
  QP_HEX.lastIndex = 0;
  for (const match of unfolded.matchAll(QP_HEX)) {
    const index = match.index ?? 0;
    for (let i = last; i < index; i++) bytes.push(unfolded.charCodeAt(i));
    bytes.push(Number.parseInt(match[1], 16));
    last = index + match[0].length;
  }
  for (let i = last; i < unfolded.length; i++)
    bytes.push(unfolded.charCodeAt(i));
  return Buffer.from(bytes);
}

function bufferEncoding(charset?: string): BufferEncoding {
  const value = String(charset || 'utf-8')
    .toLowerCase()
    .replace(/[_ ]/g, '-');
  if (value === 'us-ascii' || value === 'ascii') return 'ascii';
  if (value === 'iso-8859-1' || value === 'latin-1' || value === 'latin1') {
    return 'latin1';
  }
  return 'utf8';
}
