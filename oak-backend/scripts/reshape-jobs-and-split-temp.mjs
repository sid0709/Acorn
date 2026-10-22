#!/usr/bin/env node
/**
 * Reshape job metadata on jobs + temp_jobs, then move incomplete catalog rows
 * from jobs → temp_jobs (move, not copy).
 *
 * Metadata changes (all documents in both collections):
 *   - drop metadata.companyTags
 *   - details.position → details.location
 *   - details.money → details.salary
 *   - drop details.date
 *
 * Move to temp_jobs when NOT catalog-ready:
 *   titleReviewLabel !== APPROVED
 *   OR aiSkillStatus not in { extracted, skipped_duplicate }
 *
 * Usage:
 *   npm run migrate:temp-jobs
 *   npm run migrate:temp-jobs -- --dry-run
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const SKILL_DONE = new Set(['extracted', 'skipped_duplicate']);
const CHUNK = 200;

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

function pickString(details, ...keys) {
  for (const key of keys) {
    const value = details?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** Return reshaped metadata, or null if unchanged / absent. */
function reshapeMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const hadCompanyTags = Object.prototype.hasOwnProperty.call(
    raw,
    'companyTags',
  );
  const detailsIn = raw.details;
  const hasDetails =
    detailsIn && typeof detailsIn === 'object' && !Array.isArray(detailsIn);

  let detailsChanged = false;
  let nextDetails;
  if (hasDetails) {
    const location = pickString(detailsIn, 'location', 'position');
    const time = pickString(detailsIn, 'time');
    const remote = pickString(detailsIn, 'remote');
    const seniority = pickString(detailsIn, 'seniority');
    const salary = pickString(detailsIn, 'salary', 'money');
    const hadDate = Object.prototype.hasOwnProperty.call(detailsIn, 'date');
    const hadPosition = Object.prototype.hasOwnProperty.call(
      detailsIn,
      'position',
    );
    const hadMoney = Object.prototype.hasOwnProperty.call(detailsIn, 'money');

    nextDetails = {};
    if (location) nextDetails.location = location;
    if (time) nextDetails.time = time;
    if (remote) nextDetails.remote = remote;
    if (seniority) nextDetails.seniority = seniority;
    if (salary) nextDetails.salary = salary;

    detailsChanged =
      hadDate ||
      hadPosition ||
      hadMoney ||
      Object.keys(detailsIn).length !== Object.keys(nextDetails).length;
  }

  if (!hadCompanyTags && !detailsChanged) return null;

  const next = { ...raw };
  delete next.companyTags;
  if (hasDetails) {
    if (Object.keys(nextDetails).length) next.details = nextDetails;
    else delete next.details;
  }
  return next;
}

function isCatalogReady(doc) {
  if (doc.titleReviewLabel !== 'APPROVED') return false;
  return SKILL_DONE.has(String(doc.aiSkillStatus || '').trim());
}

async function reshapeCollection(collection, label, dryRun) {
  let scanned = 0;
  let updated = 0;
  const cursor = collection.find({}, { projection: { _id: 1, metadata: 1 } });

  const ops = [];
  for await (const doc of cursor) {
    scanned += 1;
    const next = reshapeMetadata(doc.metadata);
    if (!next) continue;
    updated += 1;
    if (!dryRun) {
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { metadata: next } },
        },
      });
      if (ops.length >= CHUNK) {
        await collection.bulkWrite(ops, { ordered: false });
        ops.length = 0;
      }
    }
  }
  if (!dryRun && ops.length) {
    await collection.bulkWrite(ops, { ordered: false });
  }
  console.log(
    `[migrate:temp-jobs] reshape ${label}: scanned=${scanned} updated=${updated}`,
  );
  return { scanned, updated };
}

async function moveIncompleteToTemp(jobs, tempJobs, dryRun) {
  const filter = {
    $or: [
      { titleReviewLabel: { $ne: 'APPROVED' } },
      { aiSkillStatus: { $nin: [...SKILL_DONE] } },
      { aiSkillStatus: null },
      { aiSkillStatus: { $exists: false } },
    ],
  };

  let moved = 0;
  let skippedExisting = 0;
  const cursor = jobs.find(filter);

  let batch = [];
  async function flush() {
    if (!batch.length) return;
    if (dryRun) {
      moved += batch.length;
      batch = [];
      return;
    }

    const ids = batch.map((d) => d._id);
    const existing = await tempJobs
      .find({ _id: { $in: ids } }, { projection: { _id: 1 } })
      .toArray();
    const existingIds = new Set(existing.map((d) => String(d._id)));
    const toInsert = batch.filter((d) => !existingIds.has(String(d._id)));
    skippedExisting += batch.length - toInsert.length;

    if (toInsert.length) {
      await tempJobs.insertMany(toInsert, { ordered: false });
    }
    await jobs.deleteMany({ _id: { $in: ids } });
    moved += batch.length;
    batch = [];
  }

  for await (const doc of cursor) {
    if (isCatalogReady(doc)) continue;
    batch.push(doc);
    if (batch.length >= CHUNK) await flush();
  }
  await flush();

  console.log(
    `[migrate:temp-jobs] move incomplete → temp_jobs: moved=${moved} alreadyInTemp=${skippedExisting}`,
  );
  return { moved, skippedExisting };
}

async function main() {
  const dryRun = isDryRun(process.argv.slice(2));
  const url = requireDbUrl();
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db();
  const jobs = db.collection('jobs');
  const tempJobs = db.collection('temp_jobs');

  console.log(`[migrate:temp-jobs] db=${db.databaseName} dryRun=${dryRun}`);

  await reshapeCollection(jobs, 'jobs', dryRun);
  await reshapeCollection(tempJobs, 'temp_jobs', dryRun);
  await moveIncompleteToTemp(jobs, tempJobs, dryRun);

  const jobsCount = await jobs.countDocuments();
  const tempCount = await tempJobs.countDocuments();
  console.log(
    `[migrate:temp-jobs] counts jobs=${jobsCount} temp_jobs=${tempCount}`,
  );
  console.log(
    '[migrate:temp-jobs] next: npm run prisma:generate (Title Review / Skill Extract read temp_jobs directly)',
  );

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
