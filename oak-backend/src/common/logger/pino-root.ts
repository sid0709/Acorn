import pino, { type LoggerOptions } from 'pino';

function envFlag(name: string): string {
  return String(process.env[name] || '')
    .trim()
    .toLowerCase();
}

function logLevel(): string {
  const configured = envFlag('LOG_LEVEL');
  if (configured) return configured;
  return envFlag('NODE_ENV') === 'production' ? 'info' : 'debug';
}

function usePretty(): boolean {
  const configured = envFlag('LOG_PRETTY');
  if (configured === 'false' || configured === '0') return false;
  if (configured === 'true' || configured === '1') return true;
  return envFlag('NODE_ENV') !== 'production';
}

const options: LoggerOptions = {
  level: logLevel(),
  base: undefined,
};

/** Process-wide Pino root. Pretty + color in local/dev; JSON in production. */
export const pinoRoot = usePretty()
  ? pino(
      options,
      pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          singleLine: true,
        },
      }),
    )
  : pino(options);
