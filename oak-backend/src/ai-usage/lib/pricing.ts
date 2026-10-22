/** Token pricing table — ported from packages/shared/src/pricing.js. */

export type PricingRow = {
  prefix: string;
  input: number;
  cachedInput: number | null;
  output: number;
};

export const STANDARD_PRICING: PricingRow[] = [
  {
    prefix: 'deepseek-v4-pro',
    input: 0.66,
    cachedInput: 0.022,
    output: 1.98,
  },
  {
    prefix: 'deepseek-v4-flash',
    input: 0.15,
    cachedInput: 0.003,
    output: 0.6,
  },
  {
    prefix: 'deepseek-flash',
    input: 0.15,
    cachedInput: 0.003,
    output: 0.6,
  },
  { prefix: 'deepseek-reasoner', input: 0.55, cachedInput: 0.14, output: 2.19 },
  { prefix: 'deepseek-chat', input: 0.27, cachedInput: 0.07, output: 1.1 },
  { prefix: 'gpt-6-luna', input: 0.1, cachedInput: 0.01, output: 0.5 },
  { prefix: 'gpt-5.6-terra', input: 2, cachedInput: 0.2, output: 12 },
  { prefix: 'gpt-5.6-luna', input: 0.2, cachedInput: 0.02, output: 1.2 },
  { prefix: 'gpt-5.6-sol', input: 5, cachedInput: 0.5, output: 30 },
  { prefix: 'gpt-5.6', input: 5, cachedInput: 0.5, output: 30 },
  { prefix: 'gpt-5.5-pro', input: 30, cachedInput: null, output: 180 },
  { prefix: 'gpt-5.5', input: 5, cachedInput: 0.5, output: 30 },
  { prefix: 'gpt-5.4-pro', input: 30, cachedInput: null, output: 180 },
  { prefix: 'gpt-5.4-mini', input: 0.75, cachedInput: 0.075, output: 4.5 },
  { prefix: 'gpt-5.4-nano', input: 0.2, cachedInput: 0.02, output: 1.25 },
  { prefix: 'gpt-5.4', input: 2.5, cachedInput: 0.25, output: 15 },
  { prefix: 'gpt-5.2-pro', input: 21, cachedInput: null, output: 168 },
  { prefix: 'gpt-5.2', input: 1.75, cachedInput: 0.175, output: 14 },
  { prefix: 'gpt-5.1', input: 1.25, cachedInput: 0.125, output: 10 },
  { prefix: 'gpt-5-pro', input: 15, cachedInput: null, output: 120 },
  { prefix: 'gpt-5-mini', input: 0.25, cachedInput: 0.025, output: 2 },
  { prefix: 'gpt-5-nano', input: 0.05, cachedInput: 0.005, output: 0.4 },
  { prefix: 'gpt-5', input: 1.25, cachedInput: 0.125, output: 10 },
  { prefix: 'gpt-4.1-mini', input: 0.4, cachedInput: 0.1, output: 1.6 },
  { prefix: 'gpt-4.1-nano', input: 0.1, cachedInput: 0.025, output: 0.4 },
  { prefix: 'gpt-4.1', input: 2, cachedInput: 0.5, output: 8 },
  { prefix: 'gpt-4o-2024-05-13', input: 5, cachedInput: null, output: 15 },
  { prefix: 'gpt-4o-mini', input: 0.15, cachedInput: 0.075, output: 0.6 },
  { prefix: 'gpt-4o', input: 2.5, cachedInput: 1.25, output: 10 },
  { prefix: 'o1-pro', input: 150, cachedInput: null, output: 600 },
  { prefix: 'o1-mini', input: 1.1, cachedInput: 0.55, output: 4.4 },
  { prefix: 'o1', input: 15, cachedInput: 7.5, output: 60 },
  { prefix: 'o3-pro', input: 20, cachedInput: null, output: 80 },
  { prefix: 'o3-mini', input: 1.1, cachedInput: 0.55, output: 4.4 },
  { prefix: 'o3', input: 2, cachedInput: 0.5, output: 8 },
  { prefix: 'o4-mini', input: 1.1, cachedInput: 0.275, output: 4.4 },
  {
    prefix: 'gpt-4-turbo-2024-04-09',
    input: 10,
    cachedInput: null,
    output: 30,
  },
  { prefix: 'gpt-4-turbo', input: 10, cachedInput: null, output: 30 },
  { prefix: 'gpt-4-0125-preview', input: 10, cachedInput: null, output: 30 },
  {
    prefix: 'gpt-4-1106-vision-preview',
    input: 10,
    cachedInput: null,
    output: 30,
  },
  { prefix: 'gpt-4-1106-preview', input: 10, cachedInput: null, output: 30 },
  { prefix: 'gpt-4-32k', input: 60, cachedInput: null, output: 120 },
  { prefix: 'gpt-4-0613', input: 30, cachedInput: null, output: 60 },
  { prefix: 'gpt-4-0314', input: 30, cachedInput: null, output: 60 },
  { prefix: 'gpt-3.5-turbo-16k-0613', input: 3, cachedInput: null, output: 4 },
  {
    prefix: 'gpt-3.5-turbo-instruct',
    input: 1.5,
    cachedInput: null,
    output: 2,
  },
  { prefix: 'gpt-3.5-turbo-0125', input: 0.5, cachedInput: null, output: 1.5 },
  { prefix: 'gpt-3.5-turbo-1106', input: 1, cachedInput: null, output: 2 },
  { prefix: 'gpt-3.5-turbo-0613', input: 1.5, cachedInput: null, output: 2 },
  { prefix: 'gpt-3.5-turbo', input: 0.5, cachedInput: null, output: 1.5 },
  { prefix: 'davinci-002', input: 2, cachedInput: null, output: 2 },
  { prefix: 'babbage-002', input: 0.4, cachedInput: null, output: 0.4 },
];

const SORTED = [...STANDARD_PRICING].sort(
  (a, b) => b.prefix.length - a.prefix.length,
);

export function findPricing(
  model: string | undefined | null,
): PricingRow | null {
  if (!model) return null;
  const id = model.toLowerCase();
  for (const row of SORTED) {
    if (id === row.prefix || id.startsWith(`${row.prefix}-`)) return row;
  }
  return null;
}

export type ParsedPromptUsage = {
  cacheMiss: number;
  cacheHit: number;
  outputTokens: number;
  totalTokens: number;
};

export function parsePromptUsage(
  usage: Record<string, unknown> | null | undefined,
): ParsedPromptUsage {
  const outputTokens =
    Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0;
  const promptTokens =
    Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0;
  const details = usage?.prompt_tokens_details as
    { cached_tokens?: unknown } | undefined;
  const inputDetails = usage?.input_tokens_details as
    { cached_tokens?: unknown } | undefined;
  const cacheHit =
    Number(
      usage?.prompt_cache_hit_tokens ??
        details?.cached_tokens ??
        inputDetails?.cached_tokens ??
        usage?.cached_input_tokens ??
        0,
    ) || 0;
  const explicitMiss = usage?.prompt_cache_miss_tokens;
  const cacheMiss =
    explicitMiss != null && explicitMiss !== ''
      ? Number(explicitMiss) || 0
      : Math.max(0, promptTokens - cacheHit);
  const totalTokens =
    Number(usage?.total_tokens ?? cacheMiss + cacheHit + outputTokens) || 0;
  return { cacheMiss, cacheHit, outputTokens, totalTokens };
}

export type CostFromUsage = {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  priced: boolean;
};

export function costFromUsage(
  model: string,
  usage: Record<string, unknown> | null | undefined,
): CostFromUsage {
  const rates = findPricing(model);
  const { cacheMiss, cacheHit, outputTokens, totalTokens } =
    parsePromptUsage(usage);
  if (!rates) {
    return {
      inputTokens: cacheMiss,
      cachedTokens: cacheHit,
      outputTokens,
      totalTokens,
      costUsd: 0,
      priced: false,
    };
  }
  const cachedRate = rates.cachedInput ?? rates.input;
  const costUsd =
    (cacheMiss * rates.input +
      cacheHit * cachedRate +
      outputTokens * rates.output) /
    1_000_000;
  return {
    inputTokens: cacheMiss,
    cachedTokens: cacheHit,
    outputTokens,
    totalTokens,
    costUsd,
    priced: true,
  };
}
