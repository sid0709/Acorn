import * as fs from 'node:fs';
import * as path from 'node:path';

export type FirebaseConfig = {
  projectId: string | null;
  storageBucket: string | null;
  credentialsPath: string | null;
  credentialsConfigured: boolean;
};

/** Resolve credentials path relative to athens-backend package root. */
export function resolveCredentialsPath(
  raw = process.env.GOOGLE_APPLICATION_CREDENTIALS,
  packageRoot = path.resolve(__dirname, '../..'),
): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(packageRoot, trimmed);
}

/** Single env read path for Firebase Admin (no secrets in source). */
export function loadFirebaseConfig(
  packageRoot = path.resolve(__dirname, '../..'),
): FirebaseConfig {
  const credentialsPath = resolveCredentialsPath(
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    packageRoot,
  );
  return {
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || null,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET?.trim() || null,
    credentialsPath,
    credentialsConfigured: Boolean(
      credentialsPath && fs.existsSync(credentialsPath),
    ),
  };
}
