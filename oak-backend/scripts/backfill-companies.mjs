#!/usr/bin/env node
/**
 * Build AthensDB.companies from searchable `jobs`, then stamp jobs.companyId.
 *
 * Company identity = normalized companyName (trim + lowercase + collapse spaces).
 * jobIds are newest-first (aggregation sorts postedAt desc before $group).
 *
 * Usage:
 *   npm run backfill:companies
 *   npm run backfill:companies -- --dry-run
 *   npm run backfill:companies -- --rebuild
 */
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const CHUNK = 1000;

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

function isRebuild(argv) {
  return argv.includes('--rebuild');
}

async function bulkWriteChunks(collection, ops, dryRun, label) {
  if (!ops.length) return 0;
  if (dryRun) {
    console.log(
      `[backfill:companies] dry-run ${label}: would write ${ops.length}`,
    );
    return ops.length;
  }
  let written = 0;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const slice = ops.slice(i, i + CHUNK);
    const result = await collection.bulkWrite(slice, { ordered: false });
    written +=
      (result.upsertedCount || 0) +
      (result.modifiedCount || 0) +
      (result.insertedCount || 0);
    console.log(
      `[backfill:companies] ${label} chunk ${Math.floor(i / CHUNK) + 1}: ` +
        `upserted=${result.upsertedCount || 0} modified=${result.modifiedCount || 0}`,
    );
  }
  return written;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = isDryRun(argv);
  const rebuild = isRebuild(argv);
  const url = requireDbUrl();
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db();
  const jobs = db.collection('jobs');
  const companies = db.collection('companies');

  console.log(
    `[backfill:companies] db=${db.databaseName} dryRun=${dryRun} rebuild=${rebuild}`,
  );

  if (rebuild && !dryRun) {
    const wiped = await companies.deleteMany({});
    console.log(`[backfill:companies] wiped companies: ${wiped.deletedCount}`);
  } else if (rebuild && dryRun) {
    console.log('[backfill:companies] dry-run: would wipe companies');
  }

  const t0 = Date.now();
  const grouped = await jobs
    .aggregate([
      {
        $addFields: {
          companyKey: {
            $trim: {
              input: {
                $toLower: {
                  $replaceAll: {
                    input: { $ifNull: ['$companyName', ''] },
                    find: '  ',
                    replacement: ' ',
                  },
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          // Collapse remaining multi-spaces after pairwise replaceAll (one pass is enough for most rows).
          companyKey: {
            $reduce: {
              input: { $split: ['$companyKey', ' '] },
              initialValue: '',
              in: {
                $cond: [
                  { $eq: ['$$this', ''] },
                  '$$value',
                  {
                    $cond: [
                      { $eq: ['$$value', ''] },
                      '$$this',
                      { $concat: ['$$value', ' ', '$$this'] },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      { $match: { companyKey: { $ne: '' } } },
      { $sort: { postedAt: -1 } },
      {
        $group: {
          _id: '$companyKey',
          companyName: { $first: '$companyName' },
          companyUrl: { $first: '$companyLink' },
          companyLogo: { $first: '$metadata.companyLogo' },
          lastPostedAt: { $max: '$postedAt' },
          jobIds: { $push: '$_id' },
          jobCount: { $sum: 1 },
        },
      },
    ])
    .toArray();

  console.log(
    `[backfill:companies] aggregated ${grouped.length} companies in ${Date.now() - t0}ms`,
  );

  const now = new Date();
  const companyOps = [];
  for (const row of grouped) {
    const companyKey = String(row._id);
    const companyName =
      String(row.companyName || companyKey).trim() || companyKey;
    const companyUrl =
      typeof row.companyUrl === 'string' && row.companyUrl.trim()
        ? row.companyUrl.trim()
        : null;
    const companyLogo =
      typeof row.companyLogo === 'string' && row.companyLogo.trim()
        ? row.companyLogo.trim()
        : null;
    const jobIds = Array.isArray(row.jobIds) ? row.jobIds : [];
    companyOps.push({
      updateOne: {
        filter: { companyKey },
        update: {
          $set: {
            companyKey,
            companyName,
            companyUrl,
            companyLogo,
            jobIds,
            lastPostedAt: row.lastPostedAt || now,
            jobCount: row.jobCount || jobIds.length,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    });
  }

  await bulkWriteChunks(companies, companyOps, dryRun, 'companies');

  // Map companyKey → company _id for job stamps.
  const keyToId = new Map();
  if (dryRun) {
    for (const row of grouped) {
      keyToId.set(String(row._id), new ObjectId());
    }
  } else {
    const cursor = companies.find(
      {},
      { projection: { _id: 1, companyKey: 1 } },
    );
    for await (const doc of cursor) {
      keyToId.set(String(doc.companyKey), doc._id);
    }
  }

  const jobOps = [];
  for (const row of grouped) {
    const companyId = keyToId.get(String(row._id));
    if (!companyId) continue;
    for (const jobId of row.jobIds || []) {
      jobOps.push({
        updateOne: {
          filter: { _id: jobId },
          update: { $set: { companyId } },
        },
      });
    }
  }

  await bulkWriteChunks(jobs, jobOps, dryRun, 'jobs.companyId');

  // Indexes (idempotent — Prisma may already have created these names).
  if (!dryRun) {
    try {
      await companies.createIndex(
        { companyKey: 1 },
        { unique: true, name: 'companies_companyKey_key' },
      );
    } catch (err) {
      if (err?.code !== 85 && err?.code !== 86) throw err;
    }
    try {
      await companies.createIndex(
        { lastPostedAt: -1 },
        { name: 'companies_lastPostedAt_idx' },
      );
    } catch (err) {
      if (err?.code !== 85 && err?.code !== 86) throw err;
    }
    try {
      await jobs.createIndex(
        { companyId: 1, postedAt: -1 },
        { name: 'jobs_companyId_postedAt_idx' },
      );
    } catch (err) {
      if (err?.code !== 85 && err?.code !== 86) throw err;
    }
  }

  console.log(
    `[backfill:companies] done companies=${grouped.length} jobStamps=${jobOps.length} ` +
      `elapsed=${Date.now() - t0}ms`,
  );
  await client.close();
}

main().catch((err) => {
  console.error('[backfill:companies] failed', err);
  process.exit(1);
});
