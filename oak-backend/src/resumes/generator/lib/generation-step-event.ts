import type { GenerationUsage } from './usage-aggregate';

export type GenerationStepEvent = {
  phase: string;
  index?: number;
  total?: number;
  name?: string;
  purpose?: unknown;
  kind?: unknown;
  usage?: GenerationUsage;
  output?: unknown;
  content?: string;
  cumulative?: GenerationUsage;
};
