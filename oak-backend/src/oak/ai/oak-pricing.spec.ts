import { summarizeUsage } from './oak-pricing';

describe('summarizeUsage', () => {
  it('uses the cost the provider billed when it reports one', () => {
    const summary = summarizeUsage(
      { prompt_tokens: 1000, completion_tokens: 100, cost: 0.00123 },
      'openai/gpt-6-luna',
    );
    expect(summary.costUsd).toBe(0.00123);
    expect(summary.priced).toBe(true);
  });

  it('prices an OpenRouter model id from the table when no cost is reported', () => {
    const summary = summarizeUsage(
      { prompt_tokens: 100_000, completion_tokens: 0 },
      'openai/gpt-6-luna',
    );
    expect(summary.costUsd).toBeCloseTo(0.01, 6);
  });
});
