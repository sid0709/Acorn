/** Allowed upload MIME types for the resume library. */
export const RESUME_ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
]);

export const RESUME_MIME_HINT = 'Unsupported file type. Use PDF, DOCX, or TXT.';
