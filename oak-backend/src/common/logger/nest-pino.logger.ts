import type { LoggerService } from '@nestjs/common';
import { pinoRoot } from './pino-root';

function contextOf(optional: unknown[]): string | undefined {
  const last = optional[optional.length - 1];
  return typeof last === 'string' ? last : undefined;
}

function textOf(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  return String(message);
}

/** Nest `LoggerService` adapter so framework logs go through Pino. */
export class NestPinoLogger implements LoggerService {
  log(message: unknown, ...optional: unknown[]) {
    pinoRoot.info({ module: contextOf(optional) }, textOf(message));
  }

  error(message: unknown, ...optional: unknown[]) {
    const stack = optional.find(
      (item) => typeof item === 'string' && item.includes('\n'),
    );
    pinoRoot.error(
      {
        module: contextOf(optional),
        err: message instanceof Error ? message : undefined,
        stack,
      },
      textOf(message),
    );
  }

  warn(message: unknown, ...optional: unknown[]) {
    pinoRoot.warn({ module: contextOf(optional) }, textOf(message));
  }

  debug(message: unknown, ...optional: unknown[]) {
    pinoRoot.debug({ module: contextOf(optional) }, textOf(message));
  }

  verbose(message: unknown, ...optional: unknown[]) {
    pinoRoot.trace({ module: contextOf(optional) }, textOf(message));
  }

  fatal(message: unknown, ...optional: unknown[]) {
    pinoRoot.fatal({ module: contextOf(optional) }, textOf(message));
  }
}
