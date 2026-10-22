#!/usr/bin/env node
/**
 * Stamp companies.sourceBuckets from catalog `jobs` (newest-first jobIds per source).
 *
 * Usage:
 *   npm run backfill:company-source-buckets
 *   npm run backfill:company-source-buckets -- --dry-run
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const CHUNK = 500;

function requireDbUrl() {
  const url = String(process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  return url;
}

function isDryRun(argv) {
  return argv.includes('--dry-run');
}

async function bulkWriteChunks(collection, ops, dryRun) {
  if (!ops.length) return 0;
  if (dryRun) {
    console.log(
      `[backfill:company-source-buckets] dry-run: would write ${ops.length}`,
    );
    return ops.length;
  }
  let written = 0;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const slice = ops.slice(i, i + CHUNK);
    const result = await collection.bulkWrite(slice, { ordered: false });
    written +=
      (result.modifiedCount || 0) +
      (result.upsertedCount || 0) +
      (result.matchedCount || 0);
    console.log(
      `[backfill:company-source-buckets] chunk ${Math.floor(i / CHUNK) + 1}: ` +
        `matched=${result.matchedCount || 0} modified=${result.modifiedCount || 0}`,
    );
  }
  return written;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = isDryRun(argv);
  const url = requireDbUrl();
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db();
  const jobs = db.collection('jobs');
  const companies = db.collection('companies');

  console.log(
    `[backfill:company-source-buckets] db=${db.databaseName} dryRun=${dryRun}`,
  );

  const t0 = Date.now();
  const grouped = await jobs
    .aggregate(
      [
        { $match: { companyId: { $exists: true, $ne: null } } },
        { $sort: { postedAt: -1 } },
        {
          $group: {
            _id: {
              companyId: '$companyId',
              source: { $ifNull: ['$source', 'Other'] },
            },
            lastPostedAt: { $max: '$postedAt' },
            jobIds: { $push: '$_id' },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: '$_id.companyId',
            sourceBuckets: {
              $push: {
                source: '$_id.source',
                lastPostedAt: '$lastPostedAt',
                count: '$count',
                jobIds: '$jobIds',
              },
            },
          },
        },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  console.log(
    `[backfill:company-source-buckets] aggregated ${grouped.length} companies ` +
      `in ${Date.now() - t0}ms`,
  );

  const now = new Date();
  const ops = grouped.map((row) => ({
    updateOne: {
      filter: { _id: row._id },
      update: {
        $set: {
          sourceBuckets: row.sourceBuckets || [],
          updatedAt: now,
        },
      },
    },
  }));

  await bulkWriteChunks(companies, ops, dryRun);

  const missingFilter = { sourceBuckets: { $exists: false } };
  if (dryRun) {
    const missing = await companies.countDocuments(missingFilter);
    console.log(
      `[backfill:company-source-buckets] dry-run: would set empty buckets on ${missing} companies`,
    );
  } else {
    const emptied = await companies.updateMany(missingFilter, {
      $set: { sourceBuckets: [], updatedAt: now },
    });
    console.log(
      `[backfill:company-source-buckets] empty buckets stamped=${emptied.modifiedCount || 0}`,
    );
  }
  console.log(
    `[backfill:company-source-buckets] done companies=${grouped.length} ` +
      `elapsed=${Date.now() - t0}ms`,
  );
  await client.close();
}

main().catch((err) => {
  console.error('[backfill:company-source-buckets] failed', err);
  process.exit(1);
});
