import type { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

/** Prisma Mongo transactional writes fail on standalone (non-replica-set) servers. */
export function isReplicaSetRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /replica set/i.test(message);
}

/** Extended JSON Date for Prisma `$runCommandRaw` (BSON Date, not ISO string). */
export function toMongoDate(
  value: Date | string | null | undefined,
): { $date: string } | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return { $date: d.toISOString() };
}

/**
 * Walk a raw Mongo document / $set payload and convert `Date` instances to
 * `{ $date: iso }` so `$runCommandRaw` stores BSON DateTime (Prisma-readable).
 */
export function toMongoJson(value: unknown): Prisma.InputJsonValue {
  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }
  if (value === null || value === undefined) {
    return null as unknown as Prisma.InputJsonValue;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toMongoJson(item));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Already Extended JSON ($oid / $date / $numberLong) — leave alone.
    if ('$date' in obj || '$oid' in obj || '$numberLong' in obj) {
      return obj as Prisma.InputJsonValue;
    }
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      out[k] = toMongoJson(v);
    }
    return out;
  }
  return value;
}

/** Delete matching docs via the Mongo wire protocol (no Prisma transaction). */
export async function rawDeleteMany(
  prisma: PrismaClient,
  collection: string,
  query: Prisma.InputJsonValue,
): Promise<number> {
  const result = await prisma.$runCommandRaw({
    delete: collection,
    deletes: [{ q: query, limit: 0 }],
  });
  return Number((result as { n?: number }).n ?? 0);
}

/** Insert one document via the Mongo wire protocol. */
export async function rawInsertOne(
  prisma: PrismaClient,
  collection: string,
  document: Prisma.InputJsonValue,
): Promise<void> {
  await rawInsertMany(prisma, collection, [document]);
}

/** Insert many documents via the Mongo wire protocol. */
export async function rawInsertMany(
  prisma: PrismaClient,
  collection: string,
  documents: Prisma.InputJsonValue[],
): Promise<number> {
  if (!documents.length) return 0;
  const result = await prisma.$runCommandRaw({
    insert: collection,
    documents: documents.map((document) => toMongoJson(document)),
    ordered: false,
  });
  return Number((result as { n?: number }).n ?? documents.length);
}

/** Update matching docs via the Mongo wire protocol. */
export async function rawUpdateMany(
  prisma: PrismaClient,
  collection: string,
  query: Prisma.InputJsonValue,
  set: Prisma.InputJsonValue,
): Promise<number> {
  const result = await prisma.$runCommandRaw({
    update: collection,
    updates: [
      {
        q: query,
        u: { $set: toMongoJson(set) },
        multi: true,
      },
    ],
  });
  return Number((result as { n?: number }).n ?? 0);
}

/** Prisma failed to map a stored value to DateTime (string, null, etc.). */
export function isInconsistentDateTime(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Failed to convert .+ to 'DateTime'/i.test(message) ||
    /Error converting field .+ DateTime/i.test(message) ||
    /Inconsistent column data/i.test(message) ||
    /incompatible value of ["']?null["']?/i.test(message)
  );
}

/**
 * Convert string ISO timestamps → BSON Date for fields Prisma maps as DateTime.
 * Uses aggregation-pipeline update (`$toDate`). Safe to call repeatedly.
 */
export async function repairStringDateFields(
  prisma: PrismaClient,
  collection: string,
  fields: string[],
): Promise<void> {
  for (const field of fields) {
    await prisma.$runCommandRaw({
      update: collection,
      updates: [
        {
          q: { [field]: { $type: 'string' } },
          u: [{ $set: { [field]: { $toDate: `$${field}` } } }],
          multi: true,
        },
      ],
    });
  }
}

/**
 * Backfill null/missing DateTime fields that Prisma maps as non-nullable.
 * Prefers bidReadyDate → createdAt → updatedAt → $$NOW.
 */
export async function repairNullDateFields(
  prisma: PrismaClient,
  collection: string,
  fields: string[],
): Promise<void> {
  const fallback = {
    $ifNull: [
      '$bidReadyDate',
      {
        $ifNull: ['$createdAt', { $ifNull: ['$updatedAt', '$$NOW'] }],
      },
    ],
  };
  for (const field of fields) {
    await prisma.$runCommandRaw({
      update: collection,
      updates: [
        {
          q: {
            $or: [{ [field]: null }, { [field]: { $exists: false } }],
          },
          u: [{ $set: { [field]: fallback } }],
          multi: true,
        },
      ],
    });
  }
}

export function objectIdIn(ids: string[]): Prisma.InputJsonValue {
  return {
    $in: ids.map((id) => ({ $oid: id })),
  };
}

const OBJECT_ID_HEX = /^[a-fA-F0-9]{24}$/;

/** 24-char hex from a string, ObjectId, or Extended JSON `{ $oid }`. */
export function asObjectIdHex(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const id = value.trim();
    return OBJECT_ID_HEX.test(id) ? id : null;
  }
  if (
    typeof Buffer !== 'undefined' &&
    Buffer.isBuffer(value) &&
    value.length === 12
  ) {
    return value.toString('hex');
  }
  if (typeof value !== 'object') return null;
  const raw = value as { $oid?: string; toHexString?: () => string };
  if (typeof raw.$oid === 'string' && OBJECT_ID_HEX.test(raw.$oid)) {
    return raw.$oid.trim();
  }
  if (typeof raw.toHexString === 'function') {
    const hex = raw.toHexString();
    if (typeof hex === 'string' && OBJECT_ID_HEX.test(hex)) return hex;
  }
  return null;
}

/**
 * Match `field` as a legacy string or BSON ObjectId for `$runCommandRaw`.
 * Some Athens-server rows store 24-hex ids as plain strings.
 */
export function mongoFieldIdQuery(
  field: string,
  id: string,
): Prisma.InputJsonValue {
  const trimmed = String(id || '').trim();
  if (!trimmed) return { [field]: trimmed };
  if (!OBJECT_ID_HEX.test(trimmed)) return { [field]: trimmed };
  return { $or: [{ [field]: { $oid: trimmed } }, { [field]: trimmed }] };
}

function mongoIdValues(ids: string[]): Prisma.InputJsonValue[] {
  const unique = [
    ...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)),
  ];
  const values: Prisma.InputJsonValue[] = [];
  for (const id of unique) {
    values.push(id);
    if (OBJECT_ID_HEX.test(id)) values.push({ $oid: id });
  }
  return values;
}

/** `$in` that matches both string and ObjectId encodings of each hex id. */
export function mongoFieldIdIn(
  field: string,
  ids: string[],
): Prisma.InputJsonValue {
  return { [field]: { $in: mongoIdValues(ids) } };
}

/** `$nin` that matches both string and ObjectId encodings of each hex id. */
export function mongoFieldIdNin(
  field: string,
  ids: string[],
): Prisma.InputJsonValue {
  return { [field]: { $nin: mongoIdValues(ids) } };
}

/**
 * Match legacy string `_id` or BSON ObjectId for `$runCommandRaw` updates.
 * Some Athens-server accounts store `_id` as a plain string.
 */
export function mongoIdQuery(id: string): Prisma.InputJsonValue {
  return mongoFieldIdQuery('_id', id);
}

/**
 * Prefer typed Prisma deleteMany; fall back to raw on standalone Mongo.
 * When Prisma reports 0, still run raw so string vs ObjectId rows are not missed.
 */
export async function deleteManyWithFallback(
  prisma: PrismaClient,
  collection: string,
  rawQuery: Prisma.InputJsonValue,
  viaPrisma: () => Promise<{ count: number }>,
): Promise<number> {
  try {
    const result = await viaPrisma();
    const extra = await rawDeleteMany(prisma, collection, rawQuery);
    return result.count + extra;
  } catch (error) {
    if (!isReplicaSetRequired(error)) throw error;
    return rawDeleteMany(prisma, collection, rawQuery);
  }
}

/** Prefer typed Prisma write; fall back to raw on standalone Mongo. */
export async function withReplicaSetFallback<T>(
  viaPrisma: () => Promise<T>,
  viaRaw: () => Promise<T>,
): Promise<T> {
  try {
    return await viaPrisma();
  } catch (error) {
    if (!isReplicaSetRequired(error)) throw error;
    return viaRaw();
  }
}
