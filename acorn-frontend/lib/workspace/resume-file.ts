import { pdfText } from "./pdf-text";

export const RESUME_MAX_BYTES = 8 * 1024 * 1024;
export const RESUME_ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,text/plain";

export function bytesToBase64(bytes: Uint8Array) {
  const chunk = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** Hands the browser a base64 file to save, e.g. an exported DOCX. */
export function saveBase64File(name: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes]));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
/** Fewer characters than this means the file is an image or empty, not a readable résumé. */
export const MIN_RESUME_TEXT = 40;

/** What the profile API reads: text the browser extracted, or the file itself for Word. */
export type ResumeUpload = { fileName: string; text?: string; contentBase64?: string };

const isPdf = (file: File) =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
const isDocx = (file: File) => file.name.toLowerCase().endsWith(".docx");

/**
 * Prepares a résumé for the profile API. PDFs are read here with their layout
 * and links; Word files go to the server whole, which reads tabs, headers, and
 * hyperlinks out of the document. Returns null when there is no readable text.
 */
export async function resumeUpload(file: File): Promise<ResumeUpload | null> {
  if (isDocx(file)) {
    return {
      fileName: file.name,
      contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
    };
  }
  const text = isPdf(file)
    ? await pdfText(new Uint8Array(await file.arrayBuffer())).catch(() => "")
    : await file.text();
  return text.trim().length < MIN_RESUME_TEXT ? null : { fileName: file.name, text };
}
