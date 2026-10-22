#!/usr/bin/env node
/**
 * Strip legacy Firestore + resumeAnalysisCatalog fields from AthensDB.account_info.
 *
 * Usage:
 *   npm run migrate:account-info-unset-legacy
 *   npm run migrate:account-info-unset-legacy -- --dry-run
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const FIELDS = [
  '_firestorePath',
  '_firestoreCreateTime',
  '_firestoreUpdateTime',
  'resumeAnalysisCatalog',
  'resumeAnalysisCatalogUpdatedAt',
];

function requireDbUrl() {
  const url = String(process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  return url;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const url = requireDbUrl();
  const client = new MongoClient(url);
  await client.connect();
  const col = client.db().collection('account_info');

  const filter = {
    $or: FIELDS.map((f) => ({ [f]: { $exists: true } })),
  };
  const matched = await col.countDocuments(filter);
  console.log(
    `[account_info] ${matched} doc(s) still have one of: ${FIELDS.join(', ')}`,
  );

  if (dryRun) {
    console.log('[account_info] dry-run — no writes');
    await client.close();
    return;
  }

  if (matched === 0) {
    console.log('[account_info] nothing to unset');
    await client.close();
    return;
  }

  const unset = Object.fromEntries(FIELDS.map((f) => [f, '']));
  const result = await col.updateMany(filter, { $unset: unset });
  console.log(
    `[account_info] matched=${result.matchedCount} modified=${result.modifiedCount}`,
  );
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
