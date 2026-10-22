/**
 * Convert Firestore values into JSON-safe shapes for the explorer UI.
 */
export function serializeFirestoreValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    try {
      return {
        __type: 'Timestamp',
        value: (value as { toDate: () => Date }).toDate().toISOString(),
      };
    } catch {
      return { __type: 'Timestamp', value: String(value) };
    }
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { latitude?: unknown }).latitude === 'number' &&
    typeof (value as { longitude?: unknown }).longitude === 'number' &&
    (value as { constructor?: { name?: string } }).constructor?.name ===
      'GeoPoint'
  ) {
    const gp = value as { latitude: number; longitude: number };
    return {
      __type: 'GeoPoint',
      latitude: gp.latitude,
      longitude: gp.longitude,
    };
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { path?: unknown }).path === 'string' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { get?: unknown }).get === 'function'
  ) {
    return {
      __type: 'DocumentReference',
      path: (value as { path: string }).path,
    };
  }

  if (Buffer.isBuffer(value)) {
    return {
      __type: 'Bytes',
      byteLength: value.byteLength,
      preview: value.toString('base64').slice(0, 64),
    };
  }

  if (Array.isArray(value)) {
    return value.map(serializeFirestoreValue);
  }

  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      out[String(k)] = serializeFirestoreValue(v);
    }
    return out;
  }

  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = serializeFirestoreValue(v);
    }
    return out;
  }

  return value;
}

export type SerializedFirestoreDocument = {
  id: string;
  path: string;
  createTime: string | null;
  updateTime: string | null;
  data: Record<string, unknown>;
  fieldCount: number;
};

type FirestoreDocLike = {
  id: string;
  ref: { path: string };
  createTime?: { toDate?: () => Date };
  updateTime?: { toDate?: () => Date };
  data: () => Record<string, unknown> | undefined;
};

export function serializeDocument(
  doc: FirestoreDocLike,
): SerializedFirestoreDocument {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    path: doc.ref.path,
    createTime: doc.createTime?.toDate?.()?.toISOString?.() || null,
    updateTime: doc.updateTime?.toDate?.()?.toISOString?.() || null,
    data: serializeFirestoreValue(data) as Record<string, unknown>,
    fieldCount: data && typeof data === 'object' ? Object.keys(data).length : 0,
  };
}

export type ParsedFirestorePath = {
  path: string;
  segments: string[];
  isCollection: boolean;
  isDocument: boolean;
};

/** Split a Firestore path into collection/document segments. */
export function parseFirestorePath(rawPath: unknown): ParsedFirestorePath {
  const path = String(rawPath || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!path) {
    return { path: '', segments: [], isCollection: false, isDocument: false };
  }
  const segments = path.split('/').filter(Boolean);
  return {
    path: segments.join('/'),
    segments,
    isCollection: segments.length % 2 === 1,
    isDocument: segments.length % 2 === 0,
  };
}
