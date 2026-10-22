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
