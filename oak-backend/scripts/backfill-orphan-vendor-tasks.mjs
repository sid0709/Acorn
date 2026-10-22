#!/usr/bin/env node
/**
 * Delete pending Bid Management stubs (`vendor_tasks` with bidReadyDate) that
 * have no matching `job_statuses.state=bid-ready` row. Job Search Bid ready is
 * the source of truth; leftover Pending cards are junk.
 *
 * Keeps done / skipped / reviewed / submitted history.
 *
 * Usage:
 *   npm run backfill:orphan-vendor-tasks -- --dry-run
 *   npm run backfill:orphan-vendor-tasks
 */
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const OBJECT_ID_HEX = /^[a-fA-F0-9]{24}$/;

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

function hexKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/** Match a 24-hex id stored as a string or BSON ObjectId. */
function idIn(value) {
  const hex = hexKey(value);
  const values = [String(value ?? '').trim() || hex];
  if (OBJECT_ID_HEX.test(hex)) {
    values.push(hex);
    values.push(new ObjectId(hex));
  }
  return [...new Set(values)];
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = isDryRun(argv);
  const url = requireDbUrl();
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db();

  const vendorTasks = db.collection('vendor_tasks');
  const jobStatuses = db.collection('job_statuses');
  const accounts = db.collection('account_info');
  const events = db.collection('bid_review_events');

  console.log(
    `[backfill:orphan-vendor-tasks] db=${db.databaseName} dryRun=${dryRun}`,
  );

  const pending = await vendorTasks
    .find({
      status: 'pending',
      bidReadyDate: { $ne: null, $exists: true },
    })
    .project({
      _id: 1,
      applierName: 1,
      jobId: 1,
      title: 1,
      company: 1,
      bidderInProcess: 1,
    })
    .toArray();

  const byApplier = new Map();
  for (const row of pending) {
    const name = String(row.applierName || '').trim();
    if (!name) continue;
    const list = byApplier.get(name) || [];
    list.push(row);
    byApplier.set(name, list);
  }

  const stats = {
    scanned: pending.length,
    appliers: byApplier.size,
    kept: 0,
    deleted: 0,
    missingAccount: 0,
    samples: [],
  };

  const t0 = Date.now();

  for (const [applierName, rows] of byApplier) {
    const account = await accounts.findOne(
      { name: applierName },
      { projection: { _id: 1, name: 1 } },
    );

    const readyIds = new Set();
    if (account?._id) {
      const ready = await jobStatuses
        .find({
          profileId: { $in: idIn(account._id) },
          state: 'bid-ready',
        })
        .project({ jobId: 1 })
        .toArray();
      for (const row of ready) readyIds.add(hexKey(row.jobId));
    } else {
      stats.missingAccount += 1;
    }

    const orphans = [];
    for (const row of rows) {
      if (readyIds.has(hexKey(row.jobId))) {
        stats.kept += 1;
        continue;
      }
      orphans.push(row);
    }

    if (!orphans.length) continue;

    for (const row of orphans) {
      stats.deleted += 1;
      if (stats.samples.length < 16) {
        stats.samples.push({
          applierName,
          jobId: hexKey(row.jobId),
          title: String(row.title || ''),
          company: String(row.company || ''),
          missingAccount: !account,
        });
      }
    }

    if (dryRun) continue;

    const orphanJobIds = orphans.flatMap((row) => idIn(row.jobId));
    const orphanTaskIds = orphans.map((row) => row._id);
    await vendorTasks.deleteMany({ _id: { $in: orphanTaskIds } });
    await events.deleteMany({
      applierName,
      jobId: { $in: orphanJobIds },
    });
  }

  console.log(
    `[backfill:orphan-vendor-tasks] scanned=${stats.scanned} ` +
      `appliers=${stats.appliers} kept=${stats.kept} ` +
      `deleted=${stats.deleted} missingAccount=${stats.missingAccount} ` +
      `elapsed=${Date.now() - t0}ms`,
  );
  for (const sample of stats.samples) {
    console.log(
      `  ${dryRun ? 'would-delete' : 'deleted'} ${sample.applierName} ` +
        `${sample.jobId} ${sample.company} / ${sample.title}` +
        `${sample.missingAccount ? ' (no account)' : ''}`,
    );
  }

  await client.close();
}

main().catch((err) => {
  console.error('[backfill:orphan-vendor-tasks] failed', err);
  process.exit(1);
});
