#!/usr/bin/env node
/**
 * Promote catalog-ready temp_jobs → jobs (delete from temp).
 *
 * Ready = titleReviewLabel APPROVED + aiSkillStatus extracted|skipped_duplicate
 *
 * Usage:
 *   npm run build && npm run promote:temp-jobs
 *   npm run promote:temp-jobs -- --dry-run
 *   npm run promote:temp-jobs -- --limit=100
 */
require('dotenv/config');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const {
  TempJobPromotionService,
} = require('../dist/jobs/temp-job-promotion.service');
const { PrismaService } = require('../dist/prisma/prisma.service');

const SKILL_DONE = ['extracted', 'skipped_duplicate'];

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  let limit = 0;
  for (const arg of argv) {
    if (arg.startsWith('--limit=')) {
      limit = Math.max(0, Number(arg.slice('--limit='.length)) || 0);
    }
  }
  return { dryRun, limit };
}

async function main() {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const promotion = app.get(TempJobPromotionService);

  const where = {
    titleReviewLabel: 'APPROVED',
    aiSkillStatus: { in: SKILL_DONE },
  };
  const total = await prisma.tempJob.count({ where });
  const rows = await prisma.tempJob.findMany({
    where,
    select: { id: true, title: true, aiSkillStatus: true },
    orderBy: { postedAt: 'desc' },
    ...(limit > 0 ? { take: limit } : {}),
  });

  console.log(
    `\nPromote ready temp_jobs: candidates=${total}, this run=${rows.length}${dryRun ? ' (dry-run)' : ''}\n`,
  );

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const row of rows) {
    if (dryRun) {
      console.log(
        `  would promote ${row.id} [${row.aiSkillStatus}] ${row.title}`,
      );
      ok += 1;
      continue;
    }
    try {
      const promoted = await promotion.promoteIfReady(row.id);
      if (promoted) {
        ok += 1;
        if (ok <= 5 || ok % 200 === 0) {
          console.log(`  promoted ${ok}/${rows.length}: ${row.id}`);
        }
      } else {
        skipped += 1;
      }
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      if (errors.length < 15) {
        errors.push({ id: row.id, message });
      }
    }
  }

  console.log(`\nDone: promoted=${ok} skipped=${skipped} failed=${failed}`);
  if (errors.length) {
    console.log('Sample errors:');
    for (const e of errors) console.log(`  ${e.id}: ${e.message}`);
  }
  console.log('');
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
