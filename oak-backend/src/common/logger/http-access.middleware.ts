import type { NextFunction, Request, Response } from 'express';
import { appLogger } from './app-logger';

const log = appLogger('http');

const SKIP = new Set(['/healthz', '/readyz']);

/** Request line for every HTTP call (no query string — may contain tokens). */
export function httpAccessLog(req: Request, res: Response, next: NextFunction) {
  const path = String(req.path || req.url || '').split('?')[0];
  if (SKIP.has(path)) {
    next();
    return;
  }

  const started = Date.now();
  res.on('finish', () => {
    const payload = {
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Date.now() - started,
    };
    if (res.statusCode >= 500) log.error(payload, 'http');
    else if (res.statusCode >= 400) log.warn(payload, 'http');
    else if (
      req.method === 'GET' ||
      req.method === 'HEAD' ||
      req.method === 'OPTIONS'
    ) {
      log.debug(payload, 'http');
    } else log.info(payload, 'http');
  });
  next();
}
