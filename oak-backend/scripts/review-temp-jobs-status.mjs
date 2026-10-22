#!/usr/bin/env node
/**
 * Report temp_jobs pipeline buckets vs Review Titles / AI analyze / promote-ready.
 *
 * Usage:
 *   node scripts/review-temp-jobs-status.mjs
 *   npm run review:temp-jobs
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const SKILL_DONE = new Set(['extracted', 'skipped_duplicate']);
const SKILL_OPEN = new Set(['pending', 'failed']);

function requireDbUrl() {
  const url = String(process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  return url;
}

function classify(doc) {
  const label = String(doc.titleReviewLabel || '').trim();
  const skill = String(doc.aiSkillStatus ?? '').trim();
  const titleFailed = doc?.metadata?.titleReview?.processingState === 'failed';

  if (titleFailed) return 'review_titles_failed';
  if (label === 'PENDING') return 'review_titles_pending';
  if (label === 'REVIEW_REQUIRED') return 'review_titles_review_required';
  if (label === 'APPROVED' && (!skill || SKILL_OPEN.has(skill))) {
    return 'ai_analyze_open';
  }
  if (label === 'APPROVED' && skill === 'analyzing')
    return 'ai_analyze_in_flight';
  if (label === 'APPROVED' && SKILL_DONE.has(skill))
    return 'promote_ready_stuck';
  return 'other';
}

async function main() {
  const url = requireDbUrl();
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db();
  const temp = db.collection('temp_jobs');
  const jobs = db.collection('jobs');

  const total = await temp.countDocuments();
  const jobsTotal = await jobs.countDocuments();

  const byLabel = await temp
    .aggregate([
      { $group: { _id: '$titleReviewLabel', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();

  const bySkill = await temp
    .aggregate([
      { $group: { _id: '$aiSkillStatus', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();

  const byCombo = await temp
    .aggregate([
      {
        $group: {
          _id: {
            label: '$titleReviewLabel',
            skill: '$aiSkillStatus',
          },
          n: { $sum: 1 },
        },
      },
      { $sort: { n: -1 } },
    ])
    .toArray();

  // Sample classify via cursor (fine for a few thousand)
  const classes = {
    review_titles_pending: 0,
    review_titles_review_required: 0,
    review_titles_failed: 0,
    ai_analyze_open: 0,
    ai_analyze_in_flight: 0,
    promote_ready_stuck: 0,
    other: 0,
  };
  const createdBy = new Map();
  let alsoInJobs = 0;
  let onlyInTemp = 0;
  const stuckIds = [];

  const cursor = temp.find(
    {},
    {
      projection: {
        titleReviewLabel: 1,
        aiSkillStatus: 1,
        createdBy: 1,
        metadata: 1,
        title: 1,
      },
    },
  );

  const ids = [];
  for await (const doc of cursor) {
    ids.push(doc._id);
    const c = classify(doc);
    classes[c] += 1;
    const cb = String(doc.createdBy || '(none)');
    createdBy.set(cb, (createdBy.get(cb) || 0) + 1);
    if (c === 'promote_ready_stuck' && stuckIds.length < 8) {
      stuckIds.push({
        id: String(doc._id),
        title: String(doc.title || '').slice(0, 80),
        skill: doc.aiSkillStatus,
        createdBy: doc.createdBy,
      });
    }
  }

  // Overlap with jobs (same _id)
  if (ids.length) {
    const existing = await jobs
      .find({ _id: { $in: ids } }, { projection: { _id: 1 } })
      .toArray();
    const existingSet = new Set(existing.map((d) => String(d._id)));
    alsoInJobs = existingSet.size;
    onlyInTemp = ids.length - alsoInJobs;
  }

  console.log('\n=== temp_jobs status (local AthensDB) ===\n');
  console.log(
    `DATABASE_URL host: ${url.replace(/\/\/.*@/, '//***@').split('?')[0]}`,
  );
  console.log(`temp_jobs total: ${total}`);
  console.log(`jobs total:      ${jobsTotal}`);
  console.log(`temp ids also in jobs: ${alsoInJobs}`);
  console.log(`temp ids only in temp: ${onlyInTemp}`);

  console.log('\n-- titleReviewLabel --');
  for (const row of byLabel) {
    console.log(`  ${JSON.stringify(row._id)}: ${row.n}`);
  }

  console.log('\n-- aiSkillStatus --');
  for (const row of bySkill) {
    console.log(`  ${JSON.stringify(row._id)}: ${row.n}`);
  }

  console.log('\n-- label × skill --');
  for (const row of byCombo) {
    console.log(
      `  ${JSON.stringify(row._id.label)} × ${JSON.stringify(row._id.skill)}: ${row.n}`,
    );
  }

  console.log('\n-- UI / pipeline buckets --');
  console.log(
    `  Review Titles (PENDING):         ${classes.review_titles_pending}`,
  );
  console.log(
    `  Review Titles (REVIEW_REQUIRED): ${classes.review_titles_review_required}`,
  );
  console.log(
    `  Review Titles (failed meta):     ${classes.review_titles_failed}`,
  );
  console.log(`  AI analyze open (pending/failed): ${classes.ai_analyze_open}`);
  console.log(
    `  AI analyze in flight (analyzing): ${classes.ai_analyze_in_flight}`,
  );
  console.log(
    `  Promote-ready stuck (APPROVED+done skill): ${classes.promote_ready_stuck}`,
  );
  console.log(`  Other:                           ${classes.other}`);

  console.log('\n-- createdBy --');
  for (const [k, n] of [...createdBy.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }

  if (stuckIds.length) {
    console.log('\n-- sample promote-ready stuck --');
    for (const s of stuckIds) {
      console.log(`  ${s.id}  [${s.skill}]  ${s.createdBy}  ${s.title}`);
    }
  }

  console.log('');
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
