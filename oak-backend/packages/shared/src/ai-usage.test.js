import { buildCallLogEntry, calculateBilledCost } from './ai-usage.js';
import { findPricing } from './pricing.js';

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const entry = buildCallLogEntry({
  service: 'ai-bff',
  feature: 'avalon-analyze-form',
  provider: 'openai',
  requestedModel: 'gpt-4o-mini',
  billedModel: 'gpt-4o-mini-2024-07-18',
  rawUsage: {
    prompt_tokens: 1000,
    completion_tokens: 200,
    prompt_tokens_details: { cached_tokens: 500 },
  },
  durationMs: 1500,
  runId: 'run_test',
  applierName: 'alice',
});

assert(entry.requestedModel === 'gpt-4o-mini', 'requestedModel');
assert(entry.billedModel === 'gpt-4o-mini-2024-07-18', 'billedModel');
assert(entry.modelMismatch === true, 'modelMismatch');
assert(entry.inputTokens === 500, `inputTokens ${entry.inputTokens}`);
assert(
  entry.cachedInputTokens === 500,
  `cachedInputTokens ${entry.cachedInputTokens}`,
);
assert(entry.outputTokens === 200, `outputTokens ${entry.outputTokens}`);
assert(entry.costUsd > 0, 'costUsd');
assert(entry.priced === true, 'priced');
assert(entry.rates.inputPer1M > 0, 'rates');

const billedCost = calculateBilledCost('gpt-4o-mini', {
  prompt_tokens: 1000,
  completion_tokens: 500,
});
assert(billedCost.costUsd === 0.00045, `billed cost ${billedCost.costUsd}`);

const gpt52 = findPricing('gpt-5.2');
assert(gpt52?.input === 1.75, `gpt-5.2 input ${gpt52?.input}`);
assert(gpt52?.output === 14, `gpt-5.2 output ${gpt52?.output}`);

const gpt6Luna = findPricing('gpt-6-luna');
assert(gpt6Luna?.input === 0.1, `gpt-6-luna input ${gpt6Luna?.input}`);
assert(
  gpt6Luna?.cachedInput === 0.01,
  `gpt-6-luna cached ${gpt6Luna?.cachedInput}`,
);
assert(gpt6Luna?.output === 0.5, `gpt-6-luna output ${gpt6Luna?.output}`);

const deepseek = findPricing('deepseek-flash');
assert(deepseek?.input === 0.15, `deepseek-flash input ${deepseek?.input}`);
assert(
  deepseek?.cachedInput === 0.003,
  `deepseek-flash cached ${deepseek?.cachedInput}`,
);
assert(deepseek?.output === 0.6, `deepseek-flash output ${deepseek?.output}`);
const deepseekLegacyFlash = findPricing('deepseek-v4-flash');
assert(
  deepseekLegacyFlash?.input === 0.15,
  `legacy flash input ${deepseekLegacyFlash?.input}`,
);

console.log('ai-usage ok');
