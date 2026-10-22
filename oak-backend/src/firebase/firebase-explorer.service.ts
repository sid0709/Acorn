import { Injectable } from '@nestjs/common';
import type { Query, WhereFilterOp } from 'firebase-admin/firestore';
import { FirebaseAdminService } from './firebase-admin.service';
import {
  DEFAULT_FIRESTORE_SEARCH_OP,
  FIREBASE_EXPLORER_LIMITS,
  FIRESTORE_SEARCH_OPS,
  type FirestoreSearchOp,
} from './constants/firebase-explorer.constants';
import {
  parseFirestorePath,
  serializeDocument,
} from './mappers/firestore-serialize';

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

@Injectable()
export class FirebaseExplorerService {
  constructor(private readonly admin: FirebaseAdminService) {}

  async fetchStatus() {
    const meta = this.admin.getMeta();
    let firestoreOk = false;
    let storageOk = false;
    let collectionCount: number | null = null;
    let firestoreError: string | null = null;
    let storageError: string | null = null;

    try {
      const collections = await this.admin.firestore().listCollections();
      firestoreOk = true;
      collectionCount = collections.length;
    } catch (err) {
      firestoreError = err instanceof Error ? err.message : String(err);
    }

    try {
      const bucket = this.admin.storageBucket();
      await bucket.getMetadata();
      storageOk = true;
    } catch (err) {
      storageError = err instanceof Error ? err.message : String(err);
    }

    return {
      ok: firestoreOk || storageOk,
      firestoreOk,
      storageOk,
      ...meta,
      collectionCount,
      firestoreError,
      storageError,
      error: firestoreError || storageError || null,
    };
  }

  async listCollections(parentPath = '') {
    const db = this.admin.firestore();
    const parsed = parseFirestorePath(parentPath);

    let refs;
    if (!parsed.path) {
      refs = await db.listCollections();
    } else if (parsed.isDocument) {
      refs = await db.doc(parsed.path).listCollections();
    } else {
      throw new Error('Parent path must be empty (root) or a document path');
    }

    const collections = await Promise.all(
      refs.map(async (ref) => {
        let documentCount: number | null = null;
        try {
          const agg = await ref.count().get();
          documentCount = agg.data().count;
        } catch {
          documentCount = null;
        }
        return {
          id: ref.id,
          path: ref.path,
          documentCount,
        };
      }),
    );

    collections.sort((a, b) => a.id.localeCompare(b.id));
    return { parentPath: parsed.path || null, collections };
  }

  async listDocuments(opts: {
    path: string;
    limit?: unknown;
    cursor?: string;
    orderField?: string;
  }) {
    const db = this.admin.firestore();
    const parsed = parseFirestorePath(opts.path);
    if (!parsed.isCollection) {
      throw new Error(
        'Path must point to a collection (odd number of segments)',
      );
    }

    const pageSize = clampLimit(
      opts.limit,
      FIREBASE_EXPLORER_LIMITS.documentsDefault,
      FIREBASE_EXPLORER_LIMITS.documentsMax,
    );
    let query: Query = db.collection(parsed.path);

    const field =
      typeof opts.orderField === 'string' && opts.orderField.trim()
        ? opts.orderField.trim()
        : null;
    query = field ? query.orderBy(field) : query.orderBy('__name__');

    if (opts.cursor) {
      const cursorDoc = await db.doc(`${parsed.path}/${opts.cursor}`).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snap = await query.limit(pageSize + 1).get();
    const docs = snap.docs.slice(0, pageSize).map(serializeDocument);
    const hasMore = snap.docs.length > pageSize;
    const nextCursor = hasMore ? snap.docs[pageSize - 1]?.id || null : null;

    return {
      path: parsed.path,
      documents: docs,
      count: docs.length,
      hasMore,
      nextCursor,
      limit: pageSize,
    };
  }

  async getDocument(path: string) {
    const db = this.admin.firestore();
    const parsed = parseFirestorePath(path);
    if (!parsed.isDocument) {
      throw new Error(
        'Path must point to a document (even number of segments)',
      );
    }

    const snap = await db.doc(parsed.path).get();
    if (!snap.exists) {
      return {
        exists: false,
        path: parsed.path,
        document: null,
        subcollections: [] as { id: string; path: string }[],
      };
    }

    const subRefs = await snap.ref.listCollections();
    const subcollections = subRefs
      .map((ref) => ({ id: ref.id, path: ref.path }))
      .sort((a, b) => a.id.localeCompare(b.id));

    return {
      exists: true,
      path: parsed.path,
      document: serializeDocument(snap),
      subcollections,
    };
  }

  async listStorage(opts: {
    prefix?: string;
    pageToken?: string;
    maxResults?: unknown;
  }) {
    const bucket = this.admin.storageBucket();
    const pageSize = clampLimit(
      opts.maxResults,
      FIREBASE_EXPLORER_LIMITS.storageDefault,
      FIREBASE_EXPLORER_LIMITS.storageMax,
    );
    const normalizedPrefix = String(opts.prefix || '').replace(/^\/+/, '');

    const [files, , apiResponse] = await bucket.getFiles({
      prefix: normalizedPrefix || undefined,
      maxResults: pageSize,
      pageToken: opts.pageToken || undefined,
      autoPaginate: false,
      delimiter: '/',
    });

    const response = apiResponse as
      { prefixes?: string[]; nextPageToken?: string } | undefined;
    const prefixes = Array.isArray(response?.prefixes) ? response.prefixes : [];
    const nextPageToken = response?.nextPageToken || null;

    return {
      bucket: bucket.name,
      prefix: normalizedPrefix,
      folders: prefixes.map((p) => ({
        name: p.replace(/\/$/, '').split('/').pop() || p,
        prefix: p,
      })),
      files: files.map((file) => ({
        name: file.name.split('/').pop() || file.name,
        fullPath: file.name,
        size: Number(file.metadata?.size || 0),
        contentType: file.metadata?.contentType || null,
        updated: file.metadata?.updated || null,
        timeCreated: file.metadata?.timeCreated || null,
      })),
      nextPageToken,
    };
  }

  async getSignedStorageUrl(
    objectPath: string,
    expiresMs = FIREBASE_EXPLORER_LIMITS.signedUrlExpiresMs,
  ) {
    const bucket = this.admin.storageBucket();
    const normalized = String(objectPath || '').replace(/^\/+/, '');
    if (!normalized) throw new Error('path is required');

    const file = bucket.file(normalized);
    const [exists] = await file.exists();
    if (!exists) throw new Error('File not found');

    const [metadata] = await file.getMetadata();
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresMs,
      version: 'v4',
    });

    return {
      bucket: bucket.name,
      path: normalized,
      url,
      expiresInMs: expiresMs,
      contentType: metadata.contentType || null,
      size: Number(metadata.size || 0),
      name: normalized.split('/').pop() || normalized,
    };
  }

  async searchDocuments(opts: {
    path: string;
    field: string;
    op?: string;
    value: unknown;
    limit?: unknown;
  }) {
    const db = this.admin.firestore();
    const parsed = parseFirestorePath(opts.path);
    if (!parsed.isCollection) {
      throw new Error('Path must point to a collection');
    }
    if (!opts.field) throw new Error('field is required');

    const pageSize = clampLimit(
      opts.limit,
      FIREBASE_EXPLORER_LIMITS.documentsDefault,
      FIREBASE_EXPLORER_LIMITS.documentsMax,
    );
    let parsedValue = opts.value;
    if (typeof opts.value === 'string') {
      try {
        parsedValue = JSON.parse(opts.value) as unknown;
      } catch {
        parsedValue = opts.value;
      }
    }

    const op = (opts.op || DEFAULT_FIRESTORE_SEARCH_OP) as FirestoreSearchOp;
    if (!(FIRESTORE_SEARCH_OPS as readonly string[]).includes(op)) {
      throw new Error(`Unsupported operator: ${op}`);
    }

    const snap = await db
      .collection(parsed.path)
      .where(opts.field, op as WhereFilterOp, parsedValue)
      .limit(pageSize)
      .get();

    return {
      path: parsed.path,
      documents: snap.docs.map(serializeDocument),
      count: snap.size,
    };
  }
}
