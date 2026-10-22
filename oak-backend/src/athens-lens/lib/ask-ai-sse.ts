import type { Response } from 'express';

/** Write one SSE event matching athens-lens `askAiForPageAnswersStream`. */
export function writeAskAiSse(
  res: Response,
  event: string,
  data: Record<string, unknown>,
): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function beginAskAiSse(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // Flush headers immediately for proxies.
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}
