import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { BackgroundTasksService } from '../background-tasks/background-tasks.service';
import { BACKGROUND_TASK_STATUSES } from '../background-tasks/constants/task-types';
import { PrismaService } from '../prisma/prisma.service';
import { STATUS_ROLLUP_BACKFILL_DAYS } from './constants/status-components';
import {
  setGauge,
  setHealthMetric,
  setHealthStateMetrics,
} from './metrics/metrics-registry';
import { PrometheusClientService } from './prometheus-client.service';
import { classifyVpsMetrics, prepareStatusResults } from './status-stabilize';
import { StatusStoreService } from './status-store.service';
import type { CheckResult } from './types/status.types';

function isMonitoringEnabled(env = process.env): boolean {
  if (env.MONITORING_ENABLED != null) {
    return String(env.MONITORING_ENABLED).toLowerCase() === 'true';
  }
  return env.NODE_ENV === 'production';
}

function failed(
  check: { component: string; name: string; failureStatus: string },
  started: number,
  error: unknown,
  message: string,
): CheckResult {
  return {
    component: check.component,
    name: check.name,
    ok: false,
    latencyMs: Math.round(performance.now() - started),
    status: check.failureStatus,
    message,
    error: error instanceof Error ? error.message : String(error),
  };
}

@Injectable()
export class MonitorLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorLoopService.name);
  private previousResults = new Map<string, CheckResult>();
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: StatusStoreService,
    private readonly prometheus: PrometheusClientService,
    private readonly prisma: PrismaService,
    private readonly backgroundTasks: BackgroundTasksService,
  ) {}

  onModuleInit() {
    if (!isMonitoringEnabled()) {
      this.logger.log(
        'Production monitoring loop is disabled in this environment',
      );
      return;
    }
    void this.tick();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext() {
    if (this.stopped) return;
    this.timer = setTimeout(
      () => void this.tick(),
      Number(process.env.MONITOR_INTERVAL_MS || 30000),
    );
    this.timer.unref?.();
  }

  private async tick() {
    if (this.stopped) return;
    try {
      await this.runCycle();
    } catch (error) {
      this.logger.warn(
        `cycle failed: ${error instanceof Error ? error.message : error}`,
      );
    }
    try {
      await this.rollupRecentDays();
    } catch (error) {
      this.logger.warn(
        `history rollup failed: ${error instanceof Error ? error.message : error}`,
      );
    }
    this.scheduleNext();
  }

  private async rollupRecentDays() {
    for (let daysAgo = 1; daysAgo <= STATUS_ROLLUP_BACKFILL_DAYS; daysAgo++) {
      const dateKey = new Date(Date.now() - daysAgo * 86400000)
        .toISOString()
        .slice(0, 10);
      try {
        await this.store.rollupDay(dateKey);
      } catch (error) {
        this.logger.warn(
          `rollup ${dateKey} failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  private httpChecks() {
    const publicPort =
      process.env.PUBLIC_PORT ||
      (process.env.NODE_ENV === 'production' ? '80' : '9030');
    const apiPort = process.env.PORT || '8980';
    return [
      {
        component: 'athens-web',
        name: 'Athens web application',
        failureStatus: 'major_outage',
        url: `http://127.0.0.1:${publicPort}/`,
      },
      {
        component: 'athens-api',
        name: 'Athens API',
        failureStatus: 'major_outage',
        url: `http://127.0.0.1:${apiPort}/readyz`,
      },
      {
        component: 'public-api',
        name: 'Public API request path',
        failureStatus: 'major_outage',
        url:
          process.env.PUBLIC_STATUS_CHECK_URL ||
          `http://127.0.0.1:${publicPort}/api/status/current`,
      },
    ];
  }

  private async checkHttp(check: {
    component: string;
    name: string;
    failureStatus: string;
    url: string;
  }): Promise<CheckResult> {
    const started = performance.now();
    try {
      const response = await fetch(check.url, {
        signal: AbortSignal.timeout(5000),
        headers: { 'user-agent': 'athens-monitor/2.0' },
      });
      const latencyMs = Math.round(performance.now() - started);
      const ok = response.status >= 200 && response.status < 300;
      return {
        component: check.component,
        name: check.name,
        ok,
        latencyMs,
        status: ok ? 'operational' : check.failureStatus,
        message: ok
          ? 'Operating normally.'
          : `Health check returned HTTP ${response.status}.`,
      };
    } catch (error) {
      return failed(
        check,
        started,
        error,
        'Health check could not reach the service.',
      );
    }
  }

  private async checkBackgroundTasks(): Promise<CheckResult> {
    const check = {
      component: 'background-tasks',
      name: 'Background task workers',
      failureStatus: 'degraded',
    };
    const started = performance.now();
    try {
      if (!(await this.backgroundTasks.isWorkerHealthy())) {
        throw new Error('Worker process is not answering on port 8981');
      }
      const now = new Date();
      const queued = await this.prisma.backgroundTask.findMany({
        where: { status: BACKGROUND_TASK_STATUSES.QUEUED },
        orderBy: { createdAt: 'asc' },
        take: 1,
      });
      const running = await this.prisma.backgroundTask.findMany({
        where: { status: BACKGROUND_TASK_STATUSES.RUNNING },
        take: 100,
      });
      const oldest = queued[0]?.createdAt;
      const oldestQueueAgeSeconds = oldest
        ? Math.max(0, (now.getTime() - oldest.getTime()) / 1000)
        : 0;
      const expiredLeaseCount = running.filter(
        (row) =>
          row.leaseExpiresAt && row.leaseExpiresAt.getTime() < now.getTime(),
      ).length;
      setGauge(
        'athens_background_queue_oldest_age_seconds',
        {},
        oldestQueueAgeSeconds,
      );
      setGauge('athens_background_expired_lease_count', {}, expiredLeaseCount);
      return {
        ...check,
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        status: 'operational',
        message:
          expiredLeaseCount > 0
            ? `Operating normally. ${expiredLeaseCount} expired lease(s) will be reclaimed.`
            : 'Operating normally.',
      };
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : 'Background task processing is delayed or unavailable.';
      return failed(check, started, error, reason);
    }
  }

  private async checkVps(): Promise<CheckResult> {
    const started = performance.now();
    try {
      const metrics = await this.prometheus.readVpsMetrics();
      const health = classifyVpsMetrics(metrics);
      return {
        component: 'vps',
        name: 'VPS infrastructure',
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        ...health,
        metrics,
      };
    } catch (error) {
      return {
        component: 'vps',
        name: 'VPS infrastructure',
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        status: 'unknown',
        message: 'Infrastructure metrics are unavailable.',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private emitResultMetrics(result: CheckResult, checkedAt: Date) {
    setHealthMetric(result.component, result.ok);
    setHealthStateMetrics(result.component, result.status, checkedAt);
    if (result.latencyMs != null) {
      setGauge(
        'athens_health_latency_ms',
        { component: result.component },
        result.latencyMs,
      );
    }
    const metrics = result.metrics;
    if (!metrics) return;
    if (Number.isFinite(metrics.cpuUtilization)) {
      setGauge('athens_vps_cpu_utilization_ratio', {}, metrics.cpuUtilization);
    }
    if (Number.isFinite(metrics.diskUtilization)) {
      setGauge(
        'athens_vps_disk_utilization_ratio',
        {},
        metrics.diskUtilization,
      );
    }
    if (Number.isFinite(metrics.memoryUtilization)) {
      setGauge(
        'athens_vps_memory_utilization_ratio',
        {},
        metrics.memoryUtilization,
      );
    }
    if (Number.isFinite(metrics.loadRatio)) {
      setGauge('athens_vps_load_ratio', {}, metrics.loadRatio);
    }
    if (Number.isFinite(metrics.uptimeSeconds)) {
      setGauge('athens_vps_uptime_seconds', {}, metrics.uptimeSeconds);
    }
  }

  async runCycle() {
    const checkedAt = new Date();
    const rawResults = await Promise.all([
      ...this.httpChecks().map((check) => this.checkHttp(check)),
      this.checkBackgroundTasks(),
      this.checkVps(),
    ]);
    const results = prepareStatusResults(rawResults, this.previousResults);
    this.previousResults = new Map(
      results.map((result) => [result.component, result]),
    );
    for (const result of results) this.emitResultMetrics(result, checkedAt);
    setGauge(
      'athens_monitor_cycle_timestamp_seconds',
      {},
      checkedAt.getTime() / 1000,
    );
    try {
      await this.store.recordChecks(results, checkedAt);
      setGauge('athens_monitor_persistence_success', {}, 1);
      setGauge(
        'athens_monitor_persistence_timestamp_seconds',
        {},
        Date.now() / 1000,
      );
    } catch (error) {
      setGauge('athens_monitor_persistence_success', {}, 0);
      this.logger.warn(
        `Mongo snapshot write failed: ${error instanceof Error ? error.message : error}`,
      );
    }
    return results;
  }
}
