import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class AuthResponseFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const payload = body as {
          message?: unknown;
          error?: unknown;
          code?: unknown;
        };
        const nested =
          payload.message &&
          typeof payload.message === 'object' &&
          !Array.isArray(payload.message)
            ? (payload.message as { message?: unknown; error?: unknown })
            : null;
        if (Array.isArray(payload.message)) {
          message = payload.message.map(String).join(', ');
        } else if (typeof payload.message === 'string' && payload.message) {
          message = payload.message;
        } else if (typeof nested?.message === 'string' && nested.message) {
          message = nested.message;
        } else if (payload.message != null) {
          message = String(payload.message);
        }
        if (typeof payload.error === 'string' && payload.error) {
          error = payload.error;
        } else if (typeof nested?.error === 'string' && nested.error) {
          error = nested.error;
        }
        if (typeof payload.code === 'string' && payload.code) {
          res.status(status).json({
            success: false,
            code: payload.code,
            message,
            error: error ?? message,
          });
          return;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    res.status(status).json({
      success: false,
      message,
      error: error ?? message,
    });
  }
}
