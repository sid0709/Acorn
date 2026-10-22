/** Word files Oak / Job Search can turn into HTML preview via mammoth. */
export function looksLikeDocx(mimeType: string, fileName: string): boolean {
  const mime = String(mimeType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  return mime.includes('wordprocessing') || name.endsWith('.docx');
}
