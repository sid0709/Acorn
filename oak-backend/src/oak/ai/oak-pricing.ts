import { costFromUsage } from '../../ai-usage/lib/pricing';

export const LONG_CONTEXT_INPUT_TOKENS = 272_000;

type Rate = {
  input: number;
  cachedInput: number;
  cacheWrite?: number;
  output: number;
};

const MODEL_RATES: Record<string, { short: Rate; long?: Rate }> = {
  'gpt-6-luna': {
    short: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
    long: { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 0.75 },
  },
  'gpt-5.6-sol': {
    short: { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 30.0 },
    long: { input: 10.0, cachedInput: 1.0, cacheWrite: 12.5, output: 45.0 },
  },
  'gpt-5.6-terra': {
    short: { input: 2.0, cachedInput: 0.2, cacheWrite: 2.5, output: 12.0 },
    long: { input: 4.0, cachedInput: 0.4, cacheWrite: 5.0, output: 18.0 },
  },
  'gpt-5.6-luna': {
    short: { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
    long: { input: 0.4, cachedInput: 0.04, cacheWrite: 0.5, output: 1.8 },
  },
  'gpt-5.4-mini': {
    short: { input: 0.75, cachedInput: 0.075, output: 4.5 },
  },
  'gpt-5.4-nano': {
    short: { input: 0.2, cachedInput: 0.02, output: 1.25 },
  },
  'gpt-5-nano': {
    short: { input: 0.05, cachedInput: 0.005, output: 0.4 },
  },
};

const ALIASES: Record<string, string> = {
  sol: 'gpt-5.6-sol',
  terra: 'gpt-5.6-terra',
  luna: 'gpt-5.6-luna',
  '6-luna': 'gpt-6-luna',
  'gpt-6-luna-fast': 'gpt-6-luna',
  '5.6-sol': 'gpt-5.6-sol',
  '5.6-terra': 'gpt-5.6-terra',
  '5.6-luna': 'gpt-5.6-luna',
  'gpt-5.6-sol-fast': 'gpt-5.6-sol',
  'gpt-5.6-terra-fast': 'gpt-5.6-terra',
  'gpt-5.6-luna-fast': 'gpt-5.6-luna',
  '5.4-mini': 'gpt-5.4-mini',
  '5.4-nano': 'gpt-5.4-nano',
  '5-nano': 'gpt-5-nano',
  'gpt5-nano': 'gpt-5-nano',
};

export type OakUsageSummary = {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  priced?: boolean;
  pricingNote?: string;
};

export function summarizeUsage(usage: unknown, model: string): OakUsageSummary {
  const u = (usage && typeof usage === 'object' ? usage : {}) as Record<
    string,
    unknown
  >;
  const details = (u.input_tokens_details ||
    u.prompt_tokens_details ||
    {}) as Record<string, unknown>;
  const inputTokens = num(u.input_tokens ?? u.prompt_tokens);
  const outputTokens = num(u.output_tokens ?? u.completion_tokens);
  const cachedInputTokens = num(
    u.prompt_cache_hit_tokens ?? details.cached_tokens,
  );
  const totalTokens = num(u.total_tokens) || inputTokens + outputTokens;
  // OpenRouter bills each call and reports the amount: that beats any price table.
  const reported = typeof u.cost === 'number' && u.cost >= 0 ? u.cost : null;
  const cost =
    reported !== null
      ? { model, costUsd: reported, priced: true, pricingNote: undefined }
      : estimateCostUsd({
          model,
          inputTokens,
          outputTokens,
          cachedInputTokens,
        });

  return {
    model: cost.model || model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens,
    costUsd: cost.costUsd,
    priced: cost.priced,
    pricingNote: cost.pricingNote,
  };
}

function estimateCostUsd(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}) {
  const { canonical, fastMultiplier } = normalizeModelId(input.model);
  if (!canonical) {
    return estimateFromStandardPricing(input);
  }

  const table = MODEL_RATES[canonical];
  const useLong =
    Boolean(table.long) && input.inputTokens > LONG_CONTEXT_INPUT_TOKENS;
  const rate = useLong && table.long ? table.long : table.short;
  const cached = Math.min(
    Math.max(0, input.cachedInputTokens ?? 0),
    Math.max(0, input.inputTokens),
  );
  const uncached = Math.max(0, input.inputTokens - cached);
  const perMillion = (tokens: number, price: number) =>
    (tokens / 1_000_000) * price * fastMultiplier;
  const costUsd =
    perMillion(uncached, rate.input) +
    perMillion(cached, rate.cachedInput) +
    perMillion(input.outputTokens, rate.output);

  return {
    model: canonical,
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    priced: true,
    pricingNote: useLong
      ? `Long-context rates (>${LONG_CONTEXT_INPUT_TOKENS} input tokens)`
      : fastMultiplier > 1
        ? 'Fast mode (2× standard rates)'
        : undefined,
  };
}

function estimateFromStandardPricing(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}) {
  const cost = costFromUsage(input.model, {
    prompt_tokens: input.inputTokens,
    completion_tokens: input.outputTokens,
    prompt_cache_hit_tokens: input.cachedInputTokens ?? 0,
  });
  if (!cost.priced) {
    return {
      model: input.model,
      costUsd: null as number | null,
      priced: false,
      pricingNote: `No list price configured for model "${input.model}"`,
    };
  }
  return {
    model: input.model,
    costUsd: Math.round(cost.costUsd * 1e6) / 1e6,
    priced: true,
    pricingNote: undefined as string | undefined,
  };
}

function normalizeModelId(model: string | null | undefined) {
  if (!model || typeof model !== 'string') {
    return { canonical: null as string | null, fastMultiplier: 1 };
  }
  // OpenRouter ids carry the vendor: "openai/gpt-6-luna".
  const raw = model
    .trim()
    .toLowerCase()
    .replace(/^[^/]+\//, '');
  const fastMultiplier =
    /(?:^|-)fast$/.test(raw) || raw.includes('-fast-') ? 2 : 1;
  const stripped = raw.replace(/-fast(?=-|$)/g, '');
  const aliased = ALIASES[stripped] || ALIASES[raw] || stripped;
  if (MODEL_RATES[aliased]) {
    return { canonical: aliased, fastMultiplier };
  }
  for (const key of Object.keys(MODEL_RATES)) {
    if (aliased === key || aliased.startsWith(`${key}-`)) {
      return { canonical: key, fastMultiplier };
    }
  }
  return { canonical: null, fastMultiplier };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
