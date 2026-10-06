import {
  RESUME_ANALYZE_CONCURRENCY,
  RESUME_BULK_UPLOAD_CONCURRENCY,
  RESUME_BULK_UPLOAD_MAX_FILES,
} from "@acorn/shared/resume-library";

const RESUME_FILE_NAME = /\.(pdf|docx?|txt)$/i;

export type FolderResume = {
  file: File;
  techStack: string;
};

export type BatchFailure = {
  fileName: string;
  error: string;
};

/** Parent folder of a directory-picked file is its tech stack, the same rule Athens uses. */
export function resumesFromFolder(
  files: FileList | File[],
): { ok: true; items: FolderResume[] } | { ok: false; message: string } {
  const items: FolderResume[] = [];
  for (const file of Array.from(files)) {
    if (file.name.startsWith(".")) continue;
    if (!RESUME_FILE_NAME.test(file.name)) continue;
    const relative =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = relative.split(/[/\\]/).filter(Boolean);
    if (parts.length < 2) continue;
    const techStack = parts[parts.length - 2]?.trim() ?? "";
    if (!techStack || techStack.startsWith(".")) continue;
    items.push({ file, techStack });
  }
  if (!items.length) {
    return {
      ok: false,
      message: "Bulk upload needs a folder of tech-stack subfolders, each holding résumé files.",
    };
  }
  if (items.length > RESUME_BULK_UPLOAD_MAX_FILES) {
    return {
      ok: false,
      message: `Choose a folder with ${RESUME_BULK_UPLOAD_MAX_FILES} résumés or fewer.`,
    };
  }
  return { ok: true, items };
}

export function stackCounts(items: FolderResume[]): { stack: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.techStack, (counts.get(item.techStack) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([stack, count]) => ({ stack, count }));
}

export function fileBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  });
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
