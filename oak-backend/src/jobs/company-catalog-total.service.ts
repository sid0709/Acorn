import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** How long an unfiltered company catalog total may be reused. */
const COMPANY_TOTAL_TTL_MS = 60_000;

/**
 * Unfiltered Job Search company-page total.
 * Avoids count on every page flip over a high-latency Mongo link.
 */
@Injectable()
export class CompanyCatalogTotalService {
  private cached: { value: number; expiresAt: number } | null = null;
  private inflight: Promise<number> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  peek(): number | null {
    if (!this.cached) return null;
    if (this.cached.expiresAt <= Date.now()) return this.cached.value;
    return this.cached.value;
  }

  invalidate() {
    this.cached = null;
  }

  async getUnfiltered(): Promise<number> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.value;
    }
    if (this.inflight) return this.inflight;

    this.inflight = this.prisma.company
      .count({})
      .then((value) => {
        this.cached = { value, expiresAt: Date.now() + COMPANY_TOTAL_TTL_MS };
        return value;
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }
}
