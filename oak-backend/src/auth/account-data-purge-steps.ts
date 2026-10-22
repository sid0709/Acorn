import type { Prisma } from '@prisma/client';
import { deleteManyWithFallback } from '../prisma/mongo-standalone';
import type { PrismaService } from '../prisma/prisma.service';

/** Must match `@@map` values in prisma/schema.prisma. */
const COLLECTIONS = {
  jobStatuses: 'job_statuses',
  vendorTasks: 'vendor_tasks',
  bidReviewEvents: 'bid_review_events',
  athensLensSessions: 'athens_lens_sessions',
  oakSessions: 'oak_sessions',
  uploadSessions: 'upload_sessions',
  resumes: 'resumes',
  resumeTemplates: 'resume_templates',
  resumeGeneratorConfig: 'resume_generator_config',
  resumeGenerations: 'resume_generations',
  backgroundTaskInputs: 'background_task_inputs',
  backgroundTasks: 'background_tasks',
  backgroundTaskReservations: 'background_task_reservations',
  mailMessages: 'mail_messages',
  mailSyncState: 'mail_sync_state',
  aiApiUsage: 'ai_api_usage',
} as const;

const OBJECT_ID_HEX = /^[a-fA-F0-9]{24}$/;

export type AccountPurgeStep = {
  label: string;
  count: () => Promise<number>;
  remove: () => Promise<number>;
};

function oidOrString(field: string, id: string): Prisma.InputJsonValue {
  if (!OBJECT_ID_HEX.test(id)) return { [field]: id };
  return {
    $or: [{ [field]: { $oid: id } }, { [field]: id }],
  };
}

function profileOrApplierQuery(
  profileId: string,
  applierName: string,
): Prisma.InputJsonValue {
  return {
    $or: [
      ...(OBJECT_ID_HEX.test(profileId)
        ? [{ profileId: { $oid: profileId } }, { profileId }]
        : [{ profileId }]),
      { applierName },
    ],
  };
}

function step(
  prisma: PrismaService,
  label: string,
  collection: string,
  rawQuery: Prisma.InputJsonValue,
  countViaPrisma: () => Promise<number>,
  deleteViaPrisma: () => Promise<{ count: number }>,
): AccountPurgeStep {
  return {
    label,
    count: countViaPrisma,
    remove: () =>
      deleteManyWithFallback(prisma, collection, rawQuery, deleteViaPrisma),
  };
}

async function reservationStep(
  prisma: PrismaService,
  profileId: string,
  applierName: string,
): Promise<AccountPurgeStep> {
  const tasks = await prisma.backgroundTask.findMany({
    where: { OR: [{ profileId }, { applierName }] },
    select: { id: true, requestId: true },
  });
  const taskIds = tasks.map((t) => t.id);
  const requestKeys = tasks
    .map((t) => String(t.requestId || '').trim())
    .filter(Boolean)
    .map((requestId) => `request:${requestId}`);

  const where =
    taskIds.length || requestKeys.length
      ? {
          OR: [
            ...(taskIds.length ? [{ taskId: { in: taskIds } }] : []),
            ...(requestKeys.length ? [{ key: { in: requestKeys } }] : []),
          ],
        }
      : null;

  const rawQuery: Prisma.InputJsonValue = {
    $or: [
      ...(taskIds.length ? [{ taskId: { $in: taskIds } }] : []),
      ...(requestKeys.length ? [{ key: { $in: requestKeys } }] : []),
    ],
  };

  return {
    label: 'Removing task reservations',
    count: async () => {
      if (!where) return 0;
      return prisma.backgroundTaskReservation.count({ where });
    },
    remove: async () => {
      if (!where) return 0;
      return deleteManyWithFallback(
        prisma,
        COLLECTIONS.backgroundTaskReservations,
        rawQuery,
        () => prisma.backgroundTaskReservation.deleteMany({ where }),
      );
    },
  };
}

/** Ordered Mongo wipe steps for one account (excludes AccountInfo). */
export async function buildAccountPurgeSteps(
  prisma: PrismaService,
  profileId: string,
  applierName: string,
): Promise<AccountPurgeStep[]> {
  const byApplier = { applierName } as Prisma.InputJsonValue;
  const byProfileOid = oidOrString('profileId', profileId);
  const byAccountId = { accountId: profileId } as Prisma.InputJsonValue;
  const byProfileOrApplier = profileOrApplierQuery(profileId, applierName);
  const resumeRaw: Prisma.InputJsonValue = {
    $or: [
      ...(OBJECT_ID_HEX.test(profileId)
        ? [{ profileId: { $oid: profileId } }, { profileId }]
        : [{ profileId }]),
      { ownerName: applierName },
    ],
  };

  const reservation = await reservationStep(prisma, profileId, applierName);

  return [
    reservation,
    step(
      prisma,
      'Removing bid status history',
      COLLECTIONS.jobStatuses,
      byProfileOid,
      () => prisma.jobStatus.count({ where: { profileId } }),
      () => prisma.jobStatus.deleteMany({ where: { profileId } }),
    ),
    step(
      prisma,
      'Removing bid queue',
      COLLECTIONS.vendorTasks,
      byApplier,
      () => prisma.vendorTask.count({ where: { applierName } }),
      () => prisma.vendorTask.deleteMany({ where: { applierName } }),
    ),
    step(
      prisma,
      'Removing bid review events',
      COLLECTIONS.bidReviewEvents,
      byApplier,
      () => prisma.bidReviewEvent.count({ where: { applierName } }),
      () => prisma.bidReviewEvent.deleteMany({ where: { applierName } }),
    ),
    step(
      prisma,
      'Removing upload sessions',
      COLLECTIONS.uploadSessions,
      byApplier,
      () => prisma.uploadSession.count({ where: { applierName } }),
      () => prisma.uploadSession.deleteMany({ where: { applierName } }),
    ),
    step(
      prisma,
      'Removing Athens Lens sessions',
      COLLECTIONS.athensLensSessions,
      byAccountId,
      () => prisma.athensLensSession.count({ where: { accountId: profileId } }),
      () =>
        prisma.athensLensSession.deleteMany({
          where: { accountId: profileId },
        }),
    ),
    step(
      prisma,
      'Removing Oak sessions',
      COLLECTIONS.oakSessions,
      byAccountId,
      () => prisma.oakSession.count({ where: { accountId: profileId } }),
      () =>
        prisma.oakSession.deleteMany({
          where: { accountId: profileId },
        }),
    ),
    step(
      prisma,
      'Removing résumé library records',
      COLLECTIONS.resumes,
      resumeRaw,
      () =>
        prisma.resume.count({
          where: { OR: [{ profileId }, { ownerName: applierName }] },
        }),
      () =>
        prisma.resume.deleteMany({
          where: { OR: [{ profileId }, { ownerName: applierName }] },
        }),
    ),
    step(
      prisma,
      'Removing résumé templates',
      COLLECTIONS.resumeTemplates,
      resumeRaw,
      () =>
        prisma.resumeTemplate.count({
          where: { OR: [{ profileId }, { ownerName: applierName }] },
        }),
      () =>
        prisma.resumeTemplate.deleteMany({
          where: { OR: [{ profileId }, { ownerName: applierName }] },
        }),
    ),
    step(
      prisma,
      'Removing résumé generator settings',
      COLLECTIONS.resumeGeneratorConfig,
      byApplier,
      () => prisma.resumeGeneratorConfig.count({ where: { applierName } }),
      () => prisma.resumeGeneratorConfig.deleteMany({ where: { applierName } }),
    ),
    step(
      prisma,
      'Removing résumé generation history',
      COLLECTIONS.resumeGenerations,
      byApplier,
      () => prisma.resumeGeneration.count({ where: { applierName } }),
      () => prisma.resumeGeneration.deleteMany({ where: { applierName } }),
    ),
    step(
      prisma,
      'Removing background task inputs',
      COLLECTIONS.backgroundTaskInputs,
      byProfileOrApplier,
      () =>
        prisma.backgroundTaskInput.count({
          where: { OR: [{ profileId }, { applierName }] },
        }),
      () =>
        prisma.backgroundTaskInput.deleteMany({
          where: { OR: [{ profileId }, { applierName }] },
        }),
    ),
    step(
      prisma,
      'Removing background tasks',
      COLLECTIONS.backgroundTasks,
      byProfileOrApplier,
      () =>
        prisma.backgroundTask.count({
          where: { OR: [{ profileId }, { applierName }] },
        }),
      () =>
        prisma.backgroundTask.deleteMany({
          where: { OR: [{ profileId }, { applierName }] },
        }),
    ),
    step(
      prisma,
      'Removing mail messages',
      COLLECTIONS.mailMessages,
      byApplier,
      () => prisma.mailMessage.count({ where: { applierName } }),
      () => prisma.mailMessage.deleteMany({ where: { applierName } }),
    ),
    step(
      prisma,
      'Removing mail sync state',
      COLLECTIONS.mailSyncState,
      byApplier,
      () => prisma.mailSyncState.count({ where: { applierName } }),
      () => prisma.mailSyncState.deleteMany({ where: { applierName } }),
    ),
    step(
      prisma,
      'Removing AI usage history',
      COLLECTIONS.aiApiUsage,
      byApplier,
      () => prisma.aiApiUsage.count({ where: { applierName } }),
      () => prisma.aiApiUsage.deleteMany({ where: { applierName } }),
    ),
  ];
}
