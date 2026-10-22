import {
  Controller,
  HttpException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { LensAskAiService } from './lens-ask-ai.service';
import { LensAuthGuard, type LensAuthedRequest } from './lens-auth.guard';
import { beginAskAiSse, writeAskAiSse } from './lib/ask-ai-sse';

@Controller('athens-lens')
@UseGuards(LensAuthGuard)
export class AthensLensAskAiController {
  constructor(private readonly askAi: LensAskAiService) {}

  @Post('ask-ai')
  async askAiHandler(
    @Req() req: LensAuthedRequest & Request,
    @Res() res: Response,
  ): Promise<void> {
    const body =
      req.body && typeof req.body === 'object'
        ? (req.body as Record<string, unknown>)
        : {};
    const pageContext =
      body.pageContext && typeof body.pageContext === 'object'
        ? (body.pageContext as Record<string, unknown>)
        : {};
    const input = {
      applierName: req.athensLensSession!.applierName,
      pageContext,
      jobId: body.jobId ? String(body.jobId) : undefined,
      jobTitle: body.jobTitle ? String(body.jobTitle) : undefined,
    };

    const wantStream =
      body.stream !== false &&
      (body.stream === true ||
        String(req.headers.accept || '').includes('text/event-stream'));

    if (!wantStream) {
      try {
        const result = await this.askAi.answer(input);
        res.json(result);
      } catch (err) {
        writeJsonError(res, err);
      }
      return;
    }

    beginAskAiSse(res);
    const abort = new AbortController();
    const onClose = () => abort.abort();
    req.once('close', onClose);

    try {
      for await (const event of this.askAi.streamAnswer({
        ...input,
        signal: abort.signal,
      })) {
        if (abort.signal.aborted || res.writableEnded) break;
        if (event.type === 'delta') {
          writeAskAiSse(res, 'token', { text: event.text });
          continue;
        }
        if (event.type === 'answers') {
          writeAskAiSse(res, 'answers', { answers: event.answers });
          continue;
        }
        writeAskAiSse(res, 'done', {
          success: true,
          mode: event.mode,
          summary: event.summary,
          answers: event.answers,
          pageUrl: event.pageUrl,
          pageTitle: event.pageTitle,
          usage: event.usage,
          timing: {
            llmMs: event.durationMs,
            ttftMs: event.ttftMs,
            model: event.model,
          },
        });
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        const message =
          err instanceof HttpException
            ? extractMessage(err)
            : err instanceof Error
              ? err.message
              : 'Unable to analyze the open page';
        const status = err instanceof HttpException ? err.getStatus() : 500;
        writeAskAiSse(res, 'error', { message, status });
      }
    } finally {
      req.off('close', onClose);
      if (!res.writableEnded) res.end();
    }
  }
}

function extractMessage(err: HttpException): string {
  const body = err.getResponse();
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    if (typeof rec.message === 'string') return rec.message;
    if (Array.isArray(rec.message)) return rec.message.map(String).join('; ');
  }
  return err.message || 'Unable to analyze the open page';
}

function writeJsonError(res: Response, err: unknown): void {
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const body = err.getResponse();
    res
      .status(status)
      .json(
        typeof body === 'object' && body
          ? body
          : { success: false, message: String(body) },
      );
    return;
  }
  res.status(500).json({
    success: false,
    message:
      err instanceof Error ? err.message : 'Unable to analyze the open page',
  });
}
