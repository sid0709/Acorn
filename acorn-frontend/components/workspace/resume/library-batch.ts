import {
  RESUME_ANALYZE_CONCURRENCY,
  RESUME_BULK_UPLOAD_CONCURRENCY,
  RESUME_BULK_UPLOAD_MAX_FILES,
  type ResumeLibraryRow,
} from "@acorn/shared/resume-library";
import { loadLibraryFile } from "@/lib/resume/api";
import { aliasFromPath, pathParts } from "./library-alias";
import { pdfText } from "@/lib/workspace/pdf-text";
import { base64ToBytes } from "@/lib/workspace/resume-file";

const RESUME_FILE_NAME = /\.(pdf|docx?|txt)$/i;

export type FolderResume = {
  file: File;
  /** The name the library lists this file under. */
  alias: string;
};

export type BatchFailure = {
  fileName: string;
  error: string;
};

/** How many aliases the bulk confirmation lists before it counts the rest. */
export const BULK_ALIAS_PREVIEW = 12;

/**
 * Every résumé under the picked folder, aliased by its path relative to that folder
 * (see `aliasFromPath`). Hidden files and folders are skipped.
 */
export function resumesFromFolder(
  files: FileList | File[],
): { ok: true; items: FolderResume[] } | { ok: false; message: string } {
  const items: FolderResume[] = [];
  for (const file of Array.from(files)) {
    if (!RESUME_FILE_NAME.test(file.name)) continue;
    const relative =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (pathParts(relative).some((part) => part.startsWith("."))) continue;
    const alias = aliasFromPath(relative);
    if (alias) items.push({ file, alias });
  }
  if (!items.length) {
    return { ok: false, message: "That folder has no PDF, Word, or text résumés in it." };
  }
  if (items.length > RESUME_BULK_UPLOAD_MAX_FILES) {
    return {
      ok: false,
      message: `Choose a folder with ${RESUME_BULK_UPLOAD_MAX_FILES} résumés or fewer.`,
    };
  }
  return { ok: true, items };
}

const base64Chunk = 8192;

function bytesBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += base64Chunk) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + base64Chunk)));
  }
  return btoa(parts.join(""));
}

const isPdf = (file: File) =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

/**
 * A stored PDF's text as pdf.js reads it, for analysis: the server's own read of a
 * PDF whose fonts keep glyph numbers is unreadable. Empty for other formats, or
 * when the file cannot be read here (the server then uses what it can read).
 */
export async function storedPdfText(row: Pick<ResumeLibraryRow, "id" | "fileName">) {
  if (!row.fileName.toLowerCase().endsWith(".pdf")) return "";
  const stored = await loadLibraryFile(row.id);
  if (!stored.ok) return "";
  const own = [stored.data.file, ...(stored.data.file.variants ?? [])].find(
    (file) => file.resumeId === row.id,
  );
  if (!own?.base64) return "";
  return pdfText(base64ToBytes(own.base64)).catch(() => "");
}

/** File bytes plus, for a PDF, the text pdf.js read so analyze is not limited to raw operators. */
export async function libraryUploadInput(file: File, title: string) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extractedText = isPdf(file) ? await pdfText(bytes).catch(() => "") : "";
  return {
    fileName: file.name,
    title,
    contentBase64: bytesBase64(bytes),
    ...(extractedText.trim() ? { extractedText } : {}),
  };
}

export function failureSummary(action: string, total: number, failed: BatchFailure[]): string {
  const sample = failed
    .slice(0, 3)
    .map((item) => `${item.fileName}: ${item.error}`)
    .join(" · ");
  return `${failed.length} of ${total} ${action}.${sample ? ` ${sample}` : ""}`;
}

/** Runs `task` with a fixed number of workers and reports each settled item. */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<BatchFailure | null>,
  onProgress: (current: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<BatchFailure[]> {
  const total = items.length;
  const workers = Math.max(1, Math.min(concurrency, total || 1));
  const failed: BatchFailure[] = [];
  let settled = 0;
  let next = 0;
  onProgress(0, total);

  async function worker() {
    while (next < items.length) {
      if (isCancelled?.()) return;
      const index = next;
      next += 1;
      const item = items[index];
      if (!item) return;
      const failure = await task(item);
      if (failure) failed.push(failure);
      settled += 1;
      onProgress(settled, total);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return failed;
}

export { RESUME_ANALYZE_CONCURRENCY, RESUME_BULK_UPLOAD_CONCURRENCY };
