/** Wrap mammoth HTML so Job Search / Bid iframes can preview a stored DOCX. */
export function wrapDocxPreviewHtml(bodyHtml: string): string {
  const body = String(bodyHtml || '').trim() || '<p>Preview unavailable.</p>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Tailored résumé</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; margin: 24px auto; max-width: 800px; color: #1a1a1a; line-height: 1.45; }
    p { margin: 0 0 0.6em; }
    table { border-collapse: collapse; width: 100%; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export async function docxBufferToPreviewHtml(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const html = await mammoth.convertToHtml({ buffer });
  return wrapDocxPreviewHtml(html.value || '');
}
