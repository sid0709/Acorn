import type { File } from '@google-cloud/storage';

const BEGIN_TIMEOUT_MS = 20_000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function startResumableUpload(
  file: File,
  input: {
    origin?: string;
    contentType: string;
    metadata: Record<string, string>;
  },
): Promise<string> {
  const [uploadUrl] = await withTimeout(
    file.createResumableUpload({
      ...(input.origin ? { origin: input.origin } : {}),
      metadata: {
        contentType: input.contentType,
        metadata: input.metadata,
      },
    }),
    BEGIN_TIMEOUT_MS,
    'Storage timed out creating a resumable upload URL',
  );
  return uploadUrl;
}

/** Create a GCS resumable URL. Retry without origin if chrome-extension is rejected. */
export async function createGcsResumableUploadUrl(
  file: File,
  input: {
    origin?: string;
    contentType: string;
    metadata: Record<string, string>;
  },
): Promise<string> {
  try {
    return await startResumableUpload(file, input);
  } catch (error) {
    if (!input.origin) throw error;
    try {
      return await startResumableUpload(file, { ...input, origin: undefined });
    } catch {
      throw error;
    }
  }
}
