declare module '@nextoffer/shared/pricing' {
  export const STANDARD_PRICING: Array<{
    prefix: string;
    input: number;
    cachedInput: number | null;
    output: number;
  }>;
  export function findPricing(
    model: string,
  ): { input: number; cachedInput?: number | null; output: number } | null;
  export function costFromUsage(
    model: string,
    usage: Record<string, unknown>,
  ): {
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    priced: boolean;
  };
  export function formatUsd(amount: number): string;
  export function mergeUsage(a: unknown, b: unknown): unknown;
  export function emptyUsage(): unknown;
}

declare module '@nextoffer/shared/models' {
  export const DEEPSEEK_BASE_URL: string;
  export const DEEPSEEK_ANTHROPIC_BASE_URL: string;
  export const DEEPSEEK_MODELS: string[];
  export const DEEPSEEK_DEFAULT_MODEL: string;
  export function isDeepSeekModel(id: string): boolean;
  export function normalizeDeepSeekModel(model: string): string;
  export function listOpenAiModels(
    apiKey: string,
  ): Promise<Array<{ id: string }>>;
}

declare module '@nextoffer/shared/skill-normalize' {
  export function toCanonical(skill: string): string;
  export function normalizeSkillSet(skills: string[]): Set<string>;
}

declare module '@nextoffer/shared/terminal-log' {
  export const TAG_COLORS: Record<string, string>;
  export const LEVEL_STYLES: Record<string, { icon: string; color: string }>;
  export function stripAnsi(text: string): string;
  export function formatFields(fields?: Record<string, unknown>): string;
  export function formatPlainLine(
    level: 'INFO' | 'WARN' | 'ERROR',
    service: string,
    tag: string,
    msg: string,
    extra?: Record<string, unknown>,
  ): string;
  export function extractBracketTag(text: string): {
    tag: string | null;
    body: string;
  };
  export function formatLogLine(
    level: 'info' | 'warn' | 'error',
    args: unknown[],
    service?: string,
  ): string;
  export function parseStyledLine(
    line: string,
    serviceName?: string,
  ): {
    time: string;
    level: 'info' | 'warn' | 'error';
    tag: string;
    message: string;
    service: string;
  };
  export function installTerminalLogger(service?: string): void;
  export interface Logger {
    info(tag: string, msg: string, extra?: Record<string, unknown>): void;
    warn(tag: string, msg: string, extra?: Record<string, unknown>): void;
    error(tag: string, msg: string, extra?: Record<string, unknown>): void;
    llm(fields: Record<string, unknown> & { msg?: string }): void;
  }
  export function createLogger(service: string): Logger;
  export function printBanner(title: string, lines?: string[]): void;
  export function requestLogger(
    tag?: string,
  ): (req: any, res: any, next: () => void) => void;
}

declare module '@nextoffer/shared/ai-usage' {
  export const LLM_CALL_LOG_COLLECTION: string;
  export function buildCallLogEntry(
    params: Record<string, unknown>,
  ): Record<string, unknown>;
  export function calculateBilledCost(
    billedModel: string,
    rawUsage: Record<string, unknown>,
  ): {
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    priced: boolean;
  };
  export function createCallLogRecorder(
    collection: unknown,
  ): (entry: Record<string, unknown>) => Promise<unknown>;
  export function ensureCallLogIndexes(collection: unknown): Promise<void>;
  export function parseCorrelationHeaders(req: {
    headers?: Record<string, string | string[] | undefined>;
  }): {
    requestId?: string;
    runId?: string;
    applierName?: string;
    feature?: string;
    jobId?: string;
  };
  export function tokensToRawUsage(
    tokens: Record<string, unknown>,
  ): Record<string, unknown>;
}
