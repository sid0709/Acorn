import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';
import {
  LIVE_MINUTES,
  STATUS_HISTORY_DAYS,
  overallStatus,
} from './constants/status-components';
import { StatusStoreService } from './status-store.service';

@Controller('status')
export class StatusController {
  constructor(private readonly store: StatusStoreService) {}

  @Get('current')
  @Header('Cache-Control', 'no-store')
  async current() {
    const components = await this.store.readCurrentStatus();
    const timestamps = components.map((component) =>
      component.lastCheckedAt ? new Date(component.lastCheckedAt).getTime() : 0,
    );
    const latest = timestamps.length ? Math.max(...timestamps) : 0;
    return {
      ok: true,
      service: 'athensai',
      status: overallStatus(components),
      updatedAt: latest > 0 ? new Date(latest).toISOString() : null,
      components,
    };
  }

  @Get('history')
  @Header('Cache-Control', 'public, max-age=60')
  async history(@Query('days') daysRaw?: string, @Query('to') to?: string) {
    const days = Math.min(
      Math.max(Number(daysRaw || STATUS_HISTORY_DAYS), 1),
      STATUS_HISTORY_DAYS,
    );
    const from = new Date(Date.now() - days * 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      ok: true,
      days,
      rollups: await this.store.readDailyRollups(from, String(to || '')),
    };
  }

  @Get('incidents')
  @Header('Cache-Control', 'public, max-age=60')
  async incidents() {
    return { ok: true, incidents: await this.store.readIncidents() };
  }

  @Get('live')
  @Header('Cache-Control', 'no-store')
  async live(@Query('minutes') minutesRaw?: string) {
    const minutes = Number(minutesRaw || 60);
    if (!(LIVE_MINUTES as readonly number[]).includes(minutes)) {
      throw new BadRequestException('Unsupported live metrics range.');
    }
    const [points, processes] = await Promise.all([
      this.store.readLiveMetrics(minutes),
      this.store.readRamProcesses(),
    ]);
    const current = points.at(-1) || null;
    return {
      ok: true,
      minutes,
      updatedAt: current?.timestamp || null,
      current,
      points,
      processes,
    };
  }

  @Get('today')
  @Header('Cache-Control', 'no-store')
  async today() {
    const timeline = await this.store.readTodayTimelines();
    return { ok: true, ...timeline };
  }

  @Get('dependencies')
  @Header('Cache-Control', 'no-store')
  async dependencies(@Query('minutes') minutesRaw?: string) {
    const minutes = Number(minutesRaw || 60);
    if (!(LIVE_MINUTES as readonly number[]).includes(minutes)) {
      throw new BadRequestException('Unsupported dependency metrics range.');
    }
    return {
      ok: true,
      minutes,
      dependencies: await this.store.readDependencyMetrics(minutes),
    };
  }
}
