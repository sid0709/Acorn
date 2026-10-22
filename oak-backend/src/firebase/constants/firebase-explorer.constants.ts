export const FIREBASE_EXPLORER_LIMITS = {
  documentsDefault: 50,
  documentsMax: 200,
  storageDefault: 100,
  storageMax: 500,
  signedUrlExpiresMs: 60 * 60 * 1000,
} as const;

export const FIRESTORE_SEARCH_OPS = [
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'array-contains',
] as const;

export type FirestoreSearchOp = (typeof FIRESTORE_SEARCH_OPS)[number];

export const DEFAULT_FIRESTORE_SEARCH_OP: FirestoreSearchOp = '==';
