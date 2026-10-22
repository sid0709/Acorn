import type { ChatUsage } from '../../../ai/openai/openai.types';
import { tokensToRawUsage } from '../../../ai-usage/lib/ai-api-usage';
import { costFromUsage, findPricing } from '../../../ai-usage/lib/pricing';

export type GenerationUsage = {
  model: string | null;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | null;
  savings: number | null;
  promptTokens: number;
  completionTokens: number;
};

export function emptyUsage(): GenerationUsage {
  return {
    model: null,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
    savings: null,
    promptTokens: 0,
    completionTokens: 0,
  };
}

export function addUsage(
  total: GenerationUsage,
  step: Partial<GenerationUsage> | null | undefined,
): GenerationUsage {
  if (!step) return total;
  const inputTokens = total.inputTokens + Number(step.inputTokens || 0);
  const cachedTokens = total.cachedTokens + Number(step.cachedTokens || 0);
  const outputTokens =
    total.outputTokens +
    Number(step.outputTokens ?? step.completionTokens ?? 0);
  return {
    model: step.model || total.model,
    inputTokens,
    cachedTokens,
    outputTokens,
    totalTokens: total.totalTokens + Number(step.totalTokens || 0),
    cost: Number(total.cost || 0) + Number(step.cost || 0),
    savings: sumNullable(total.savings, step.savings),
    promptTokens: inputTokens + cachedTokens,
    completionTokens: outputTokens,
  };
}

export function usageWithCost(
  usage: ChatUsage | null | undefined,
  model: string,
): GenerationUsage {
  const cost = costFromUsage(
    model,
    tokensToRawUsage({
      promptTokens: Number(usage?.promptTokens || 0),
      cachedTokens: Number(usage?.cachedTokens || 0),
      completionTokens: Number(usage?.completionTokens || 0),
      totalTokens: usage?.totalTokens,
    }),
  );
  return {
    model: model || null,
    inputTokens: cost.inputTokens,
    cachedTokens: cost.cachedTokens,
    outputTokens: cost.outputTokens,
    totalTokens: cost.totalTokens,
    cost: cost.priced ? cost.costUsd : null,
    savings: cacheSavingsUsd(model, cost.cachedTokens),
    promptTokens: cost.inputTokens + cost.cachedTokens,
    completionTokens: cost.outputTokens,
  };
}

function cacheSavingsUsd(model: string, cachedTokens: number): number | null {
  const rates = findPricing(model);
  if (!rates || cachedTokens <= 0) return null;
  const cachedRate = rates.cachedInput ?? rates.input;
  const saved = (cachedTokens * (rates.input - cachedRate)) / 1_000_000;
  return saved > 0 ? saved : null;
}

function sumNullable(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a == null && b == null) return null;
  return Number(a || 0) + Number(b || 0);
}
