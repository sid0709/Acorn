import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Liveness/readiness outside the /api prefix (excluded in main.ts).
 */
@Controller()
export class HealthController {
  @Get('readyz')
  @Header('Cache-Control', 'no-store')
  readyz() {
    return { ok: true, service: 'athens-backend' };
  }

  @Get('healthz')
  @Header('Cache-Control', 'no-store')
  healthz(@Res() res: Response) {
    return res.status(200).json({ ok: true });
  }
}
