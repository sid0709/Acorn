#!/usr/bin/env node
/**
 * Align existing temp_jobs documents to the ingest staging schema:
 *   - postedAgo (optional relative text)
 *   - postedAt as Date
 *   - flatten residual nested company → companyName + metadata.companyLogo
 *   - move tags / skills / applicants / duplicateWindowDays into metadata.scrape
 *   - reshape metadata (position→location, money→salary, drop top-level companyTags)
 *   - ensure titleReviewLabel, model_schema_code, createdBy, sourceCatalog, aiSkillStatus
 *
 * Usage:
 *   npm run migrate:temp-ingest
 *   npm run migrate:temp-ingest -- --dry-run
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const CHUNK = 200;
const MODEL_SCHEMA_CODE = '2026.08.06-temp-ingest-v1';

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

function asObject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw;
}

function pickString(details, ...keys) {
  for (const key of keys) {
    const value = details?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function asStringArray(raw) {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function reshapeDetails(raw) {
  const details = asObject(raw);
  if (!details) return undefined;
  const next = {};
  const location = pickString(details, 'location', 'position');
  const time = pickString(details, 'time');
  const remote = pickString(details, 'remote');
  const seniority = pickString(details, 'seniority');
  const salary = pickString(details, 'salary', 'money');
  if (location) next.location = location;
  if (time) next.time = time;
  if (remote) next.remote = remote;
  if (seniority) next.seniority = seniority;
  if (salary) next.salary = salary;
  return Object.keys(next).length ? next : undefined;
}

function toDate(value, fallback) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

/** Build $set / $unset for one temp_jobs document. Returns null if unchanged. */
function alignDoc(doc) {
  const now = new Date();
  const set = {};
  const unset = {};

  let meta = asObject(doc.metadata) ? { ...doc.metadata } : {};
  let metaChanged = false;

  // Flatten residual nested company
  const company = asObject(doc.company);
  if (company) {
    if (
      !doc.companyName &&
      typeof company.name === 'string' &&
      company.name.trim()
    ) {
      set.companyName = company.name.trim();
    }
    if (
      typeof company.logo === 'string' &&
      company.logo.trim() &&
      !meta.companyLogo
    ) {
      meta.companyLogo = company.logo.trim();
      metaChanged = true;
    }
    if (Array.isArray(company.tags) && company.tags.length) {
      const scrape = asObject(meta.scrape) ? { ...meta.scrape } : {};
      if (!scrape.companyTags) {
        scrape.companyTags = asStringArray(company.tags) || [];
        meta.scrape = scrape;
        metaChanged = true;
      }
    }
    unset.company = '';
  }

  // Move top-level scrape extras into metadata.scrape
  const scrape = asObject(meta.scrape) ? { ...meta.scrape } : {};
  let scrapeChanged = false;
  for (const key of ['tags', 'skills', 'applicants', 'duplicateWindowDays']) {
    if (Object.prototype.hasOwnProperty.call(doc, key) && doc[key] != null) {
      if (scrape[key] == null) {
        scrape[key] = doc[key];
        scrapeChanged = true;
      }
      unset[key] = '';
    }
  }
  if (scrapeChanged) {
    meta.scrape = scrape;
    metaChanged = true;
  }

  // Reshape details + drop top-level companyTags on metadata
  if (Object.prototype.hasOwnProperty.call(meta, 'companyTags')) {
    delete meta.companyTags;
    metaChanged = true;
  }
  if (meta.details != null) {
    const nextDetails = reshapeDetails(meta.details);
    const prev = JSON.stringify(meta.details);
    const next = nextDetails ? JSON.stringify(nextDetails) : '';
    if (prev !== next) {
      if (nextDetails) meta.details = nextDetails;
      else delete meta.details;
      metaChanged = true;
    }
  }

  // postedAgo from residual relative fields
  const postedAgo =
    (typeof doc.postedAgo === 'string' && doc.postedAgo.trim()) ||
    (typeof doc.postedAt === 'string' && /ago/i.test(doc.postedAt)
      ? doc.postedAt.trim()
      : '') ||
    '';
  if (postedAgo && doc.postedAgo !== postedAgo) {
    set.postedAgo = postedAgo;
  }

  const createdAt = toDate(doc.createdAt, now);
  const postedAt = toDate(doc.postedAt, createdAt);
  if (
    !(doc.postedAt instanceof Date) ||
    Number.isNaN(new Date(doc.postedAt).getTime())
  ) {
    set.postedAt = postedAt;
  }

  if (!doc.titleReviewLabel) set.titleReviewLabel = 'PENDING';
  if (!doc.model_schema_code && !doc.modelSchemaCode) {
    set.model_schema_code = MODEL_SCHEMA_CODE;
  }
  if (!doc.createdBy) set.createdBy = 'unknown';
  if (!doc.sourceCatalog) set.sourceCatalog = 'external';
  if (doc.aiSkillStatus == null || doc.aiSkillStatus === '') {
    set.aiSkillStatus = 'pending';
  }
  if (!doc.source) set.source = 'Other';
  if (!doc.companyName && !set.companyName) set.companyName = 'Unknown';
  if (!doc.title) set.title = 'Untitled';

  if (metaChanged) {
    set.metadata = Object.keys(meta).length ? meta : null;
  }

  const hasSet = Object.keys(set).length > 0;
  const hasUnset = Object.keys(unset).length > 0;
  if (!hasSet && !hasUnset) return null;

  const update = {};
  if (hasSet) update.$set = set;
  if (hasUnset) update.$unset = unset;
  return update;
}

async function main() {
  const dryRun = isDryRun(process.argv.slice(2));
  const client = new MongoClient(requireDbUrl());
  await client.connect();
  const db = client.db();
  const tempJobs = db.collection('temp_jobs');

  console.log(`[migrate:temp-ingest] db=${db.databaseName} dryRun=${dryRun}`);

  let scanned = 0;
  let updated = 0;
  const ops = [];

  const cursor = tempJobs.find({});
  for await (const doc of cursor) {
    scanned += 1;
    const update = alignDoc(doc);
    if (!update) continue;
    updated += 1;
    if (!dryRun) {
      ops.push({
        updateOne: { filter: { _id: doc._id }, update },
      });
      if (ops.length >= CHUNK) {
        await tempJobs.bulkWrite(ops, { ordered: false });
        ops.length = 0;
      }
    }
  }
  if (!dryRun && ops.length) {
    await tempJobs.bulkWrite(ops, { ordered: false });
  }

  console.log(`[migrate:temp-ingest] scanned=${scanned} updated=${updated}`);
  await client.close();
}

main().catch((err) => {
  console.error('[migrate:temp-ingest] failed:', err);
  process.exit(1);
});
