import type { Prisma } from '@prisma/client';

/**
 * Card fields only — omit `description` (and other bulky columns) so list
 * pages stay small. Full JD loads via GET /jobs/:id on View JD.
 */
export const JOB_LIST_SELECT = {
  id: true,
  title: true,
  companyName: true,
  companyId: true,
  source: true,
  postedAt: true,
  applyLink: true,
  companyLink: true,
  aiSkills: true,
  aiSkillStatus: true,
  sourceCatalog: true,
  metadata: true,
} as const satisfies Prisma.JobSelect;

export type JobListRow = Prisma.JobGetPayload<{
  select: typeof JOB_LIST_SELECT;
}>;
