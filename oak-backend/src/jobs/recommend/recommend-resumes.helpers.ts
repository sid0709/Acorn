const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

export type RecommendOneResult = {
  recommendedResume: string | null;
  matchedCatalogKey: string | null;
  useCustomizedResume: boolean;
  warning: string | null;
  reason: string | null;
};

export type RecommendOneOutcome = {
  result: RecommendOneResult;
  mode: 'llm' | 'heuristic';
  usage: Record<string, unknown> | null;
  requestId: string | null;
};

export function heuristicRecommend(input: {
  useCustomizedResume: boolean;
  warning: string;
  reason: string;
}): RecommendOneOutcome {
  return {
    result: {
      recommendedResume: null,
      matchedCatalogKey: null,
      useCustomizedResume: input.useCustomizedResume,
      warning: input.warning,
      reason: input.reason,
    },
    mode: 'heuristic',
    usage: null,
    requestId: null,
  };
}

export function normalizeRecommendJobIds(
  raw: string[],
  maxJobs: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    const jobId = String(id || '').trim();
    if (!OBJECT_ID_RE.test(jobId) || seen.has(jobId)) continue;
    seen.add(jobId);
    out.push(jobId);
    if (out.length >= maxJobs) break;
  }
  return out;
}
