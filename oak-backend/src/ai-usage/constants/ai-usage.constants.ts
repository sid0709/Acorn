export const AI_USAGE_COLLECTION = 'ai_api_usage';

export const AI_USAGE_SERVICE = 'athens-backend' as const;

export type AiUsageTotals = {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export const EMPTY_AI_USAGE_TOTALS: AiUsageTotals = {
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
};

export const AI_USAGE_KEY_PROVIDERS = [
  { provider: 'openai', field: 'openaiApiKey' },
  { provider: 'deepseek', field: 'deepseekApiKey' },
] as const;

export const AI_USAGE_TOTALS_GROUP = {
  _id: null,
  calls: { $sum: 1 },
  inputTokens: { $sum: '$inputTokens' },
  cachedInputTokens: { $sum: '$cachedInputTokens' },
  outputTokens: { $sum: '$outputTokens' },
  totalTokens: { $sum: '$totalTokens' },
  costUsd: { $sum: '$costUsd' },
} as const;

export const AI_USAGE_BY_DAY_PIPELINE = [
  {
    $group: {
      _id: {
        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
      },
      calls: { $sum: 1 },
      inputTokens: { $sum: '$inputTokens' },
      cachedInputTokens: { $sum: '$cachedInputTokens' },
      outputTokens: { $sum: '$outputTokens' },
      totalTokens: { $sum: '$totalTokens' },
      costUsd: { $sum: '$costUsd' },
    },
  },
  { $sort: { _id: 1 } },
] as const;

export const AI_USAGE_FEATURES = {
  lensAskAi: 'athens-lens-ask-ai',
  mailWrite: 'mail-ai-write',
  mailLabel: 'mail-ai-label',
  jobAiAnalyze: 'job-ai-analyze',
  jobTitleReview: 'job-title-review',
  recommendResume: 'recommend-resume',
  resumeAnalyze: 'resume-analyze',
  resumeCoverageAnalyze: 'resume-coverage-analysis',
  oakAiAnalyze: 'oak-ai-analyze',
  oakMatchOption: 'oak-match-option',
  oakAiProse: 'oak-ai-prose',
  oakAiQa: 'oak-ai-qa',
  oakAiIdentity: 'oak-ai-identity',
  oakExtractJd: 'oak-extract-jd',
} as const;
