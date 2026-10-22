/** Job Search Recommend assignment for a Worker pool job. */
export type OakRecommendAssignment = {
  recommendedResumeId?: string | null;
  recommendedResumeStack?: string | null;
} | null;

export function assignedResumeId(recommend: OakRecommendAssignment): string {
  return String(recommend?.recommendedResumeId || '').trim();
}

export function assignedResumeStack(recommend: OakRecommendAssignment): string {
  return String(recommend?.recommendedResumeStack || '').trim();
}
