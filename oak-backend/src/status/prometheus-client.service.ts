import { Injectable } from '@nestjs/common';
import {
  DEFAULT_PROMETHEUS_URL,
  DEPENDENCY_QUERIES,
  HEALTH_DAILY_AVAILABILITY,
  HEALTH_DAILY_SAMPLE_COUNT,
  HEALTH_DAILY_SEVERITY,
  HEALTH_DAY_EXPECTED_SAMPLES,
  LIVE_VPS_QUERIES,
  PROMETHEUS_HISTORY_TIMEOUT_MS,
  PROMETHEUS_REQUEST_TIMEOUT_MS,
  SEVERITY_STATUS,
  TOP_PROCESS_MEMORY_BYTES,
  VPS_QUERIES,
  stepForMinutes,
} from './constants/prometheus-queries';
import type { StatusComponentDef } from './constants/status-components';
import type {
  DailyComponentRollup,
  LiveMetricPoint,
  RamProcessShare,
  VpsMetrics,
} from './types/status.types';

type PromOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  time?: Date;
  timeoutMs?: number;
};

@Injectable()
export class PrometheusClientService {
  private base(url?: string): string {
    return (
      url ||
      process.env.PROMETHEUS_URL ||
      DEFAULT_PROMETHEUS_URL
    ).replace(/\/+$/, '');
  }

  private async request(
    path: string,
    params: Record<string, string | number>,
    options: PromOptions = {},
  ) {
    const fetchImpl = options.fetchImpl || fetch;
    const url = new URL(path, `${this.base(options.baseUrl)}/`);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, String(value));
    }
    const response = await fetchImpl(url, {
      headers: { 'user-agent': 'athens-monitor/2.0' },
      signal: AbortSignal.timeout(
        options.timeoutMs || PROMETHEUS_REQUEST_TIMEOUT_MS,
      ),
    });
    if (!response.ok) {
      throw new Error(`Prometheus request failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      status?: string;
      error?: string;
      data?: unknown;
    };
    if (payload?.status !== 'success') {
      throw new Error(
        `Prometheus request failed: ${payload?.error || 'invalid response'}`,
      );
    }
    return payload.data as {
      resultType: string;
      result?: Array<{
        metric?: Record<string, string>;
        value?: [number, string];
        values?: Array<[number, string]>;
      }>;
    };
  }

  async query(expression: string, options: PromOptions = {}) {
    return this.request(
      '/api/v1/query',
      {
        query: expression,
        ...(options.time ? { time: options.time.getTime() / 1000 } : {}),
      },
      options,
    );
  }

  async queryRange(
    expression: string,
    range: { start: Date; end: Date; step: number },
    options: PromOptions = {},
  ) {
    return this.request(
      '/api/v1/query_range',
      {
        query: expression,
        start: range.start.getTime() / 1000,
        end: range.end.getTime() / 1000,
        step: range.step,
      },
      options,
    );
  }

  private scalar(
    data: Awaited<ReturnType<PrometheusClientService['query']>>,
    name: string,
  ) {
    if (data?.resultType !== 'vector') {
      throw new Error(`Prometheus returned an invalid response for ${name}`);
    }
    const value = Number(data.result?.[0]?.value?.[1]);
    if (!Number.isFinite(value)) {
      throw new Error(`Prometheus has no current value for ${name}`);
    }
    return value;
  }

  async readVpsMetrics(options: PromOptions = {}): Promise<VpsMetrics> {
    const maxAge = Number(process.env.PROMETHEUS_MAX_SCRAPE_AGE_SECONDS || 120);
    const entries = await Promise.all(
      Object.entries(VPS_QUERIES).map(async ([name, expression]) => [
        name,
        this.scalar(await this.query(String(expression), options), name),
      ]),
    );
    const values = Object.fromEntries(entries) as Record<string, number>;
    for (const name of [
      'cpuUtilization',
      'memoryUtilization',
      'diskUtilization',
    ]) {
      if (values[name] < 0 || values[name] > 1) {
        throw new Error(
          `Prometheus returned an out-of-range value for ${name}`,
        );
      }
    }
    if (
      values.loadRatio < 0 ||
      values.uptimeSeconds < 0 ||
      values.scrapeAgeSeconds < 0
    ) {
      throw new Error('Prometheus returned an invalid negative VPS metric');
    }
    if (values.scrapeAgeSeconds > maxAge) {
      throw new Error(
        `Prometheus node-exporter data is stale (${Math.round(values.scrapeAgeSeconds)} seconds old)`,
      );
    }
    return {
      cpuUtilization: values.cpuUtilization,
      memoryUtilization: values.memoryUtilization,
      diskUtilization: values.diskUtilization,
      loadRatio: values.loadRatio,
      uptimeSeconds: values.uptimeSeconds,
    };
  }

  private vectorByLabel(
    data: Awaited<ReturnType<PrometheusClientService['query']>>,
    label: string,
  ) {
    if (data?.resultType !== 'vector') {
      throw new Error('Prometheus returned an invalid vector response');
    }
    return new Map(
      (data.result || []).flatMap((row) => {
        const id = row.metric?.[label];
        const value = Number(row.value?.[1]);
        return id && Number.isFinite(value)
          ? [[id, { value, timestamp: Number(row.value?.[0]) }]]
          : [];
      }),
    );
  }

  private scalarsByComponent(
    data: Awaited<ReturnType<PrometheusClientService['query']>>,
  ) {
    return new Map(
      [...this.vectorByLabel(data, 'component')].map(([id, row]) => [
        id,
        row.value,
      ]),
    );
  }

  private dailyRollupFromSeries(
    definitions: StatusComponentDef[],
    dateKey: string,
    availability: Map<string, number>,
    severity: Map<string, number>,
    sampleCounts: Map<string, number> = new Map(),
  ) {
    const components = definitions.map((definition) => {
      const sampleCount = sampleCounts.get(definition.id) ?? 0;
      const availabilityRatio = availability.get(definition.id);
      const worst = severity.get(definition.id);
      const coveragePercent =
        sampleCount > 0
          ? Math.min(100, (100 * sampleCount) / HEALTH_DAY_EXPECTED_SAMPLES)
          : availabilityRatio == null
            ? 0
            : 100;
      return {
        date: dateKey,
        component: definition.id,
        name: definition.name,
        sampleCount,
        successCount:
          availabilityRatio == null || sampleCount <= 0
            ? 0
            : Math.round(sampleCount * availabilityRatio),
        availabilityPercent:
          availabilityRatio == null
            ? null
            : Math.round(availabilityRatio * 10000) / 100,
        avgLatencyMs: null,
        maxLatencyMs: null,
        healthStatus:
          worst == null || !Number.isFinite(worst)
            ? null
            : SEVERITY_STATUS[Math.round(worst)] || 'unknown',
        coveragePercent,
      } satisfies DailyComponentRollup;
    });
    return {
      date: dateKey,
      complete: components.every((item) => (item.coveragePercent || 0) >= 95),
      components,
    };
  }

  async readCurrentStatus(
    definitions: StatusComponentDef[],
    options: PromOptions = {},
  ) {
    const [statesData, timestampsData, latencyData, uptimeData] =
      await Promise.all([
        this.query('athens_health_state == 1', options),
        this.query('athens_health_check_timestamp_seconds', options),
        this.query('athens_health_latency_ms', options),
        this.query('100 * avg_over_time(athens_health_status[24h])', options),
      ]);
    const timestamps = this.vectorByLabel(timestampsData, 'component');
    const latencies = this.vectorByLabel(latencyData, 'component');
    const uptime = this.vectorByLabel(uptimeData, 'component');
    const stateRows = new Map(
      (statesData.result || []).flatMap((row) => {
        const component = row.metric?.component;
        const status = row.metric?.status;
        return component && status ? [[component, status]] : [];
      }),
    );
    const now = Date.now();
    const staleAfterMs = Number(process.env.MONITOR_STALE_AFTER_MS || 120000);
    return new Map(
      definitions.map((definition) => {
        const checkedSeconds = timestamps.get(definition.id)?.value;
        const checkedMs = Number(checkedSeconds) * 1000;
        const stale =
          !Number.isFinite(checkedMs) || now - checkedMs > staleAfterMs;
        return [
          definition.id,
          {
            component: definition.id,
            name: definition.name,
            status: stale
              ? 'unknown'
              : stateRows.get(definition.id) || 'unknown',
            lastCheckedAt: Number.isFinite(checkedMs)
              ? new Date(checkedMs)
              : null,
            latencyMs: latencies.get(definition.id)?.value ?? null,
            uptimePercent: uptime.get(definition.id)?.value ?? null,
          },
        ] as const;
      }),
    );
  }

  private mergeRangeSeries(
    seriesByName: Record<string, { values?: Array<[number, string]> } | null>,
    transforms: Record<string, (value: number) => number> = {},
  ) {
    const points = new Map<number, Record<string, unknown>>();
    for (const [name, series] of Object.entries(seriesByName)) {
      for (const [timestamp, raw] of series?.values || []) {
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        const key = Number(timestamp);
        const point = points.get(key) || {
          timestamp: new Date(key * 1000).toISOString(),
        };
        point[name] = transforms[name] ? transforms[name](value) : value;
        points.set(key, point);
      }
    }
    return [...points.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, point]) => point);
  }

  async readLiveMetrics(
    minutes = 60,
    options: PromOptions = {},
  ): Promise<LiveMetricPoint[]> {
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60 * 1000);
    const step = stepForMinutes(minutes);
    const entries = await Promise.all(
      Object.entries(LIVE_VPS_QUERIES).map(async ([name, expression]) => {
        const data = await this.queryRange(
          String(expression),
          { start, end, step },
          options,
        );
        return [name, data.result?.[0] || null] as const;
      }),
    );
    const toPercent = (v: number) => Math.round(v * 1000) / 10;
    return this.mergeRangeSeries(Object.fromEntries(entries), {
      cpuUtilization: toPercent,
      memoryUtilization: toPercent,
      diskUtilization: toPercent,
      loadRatio: toPercent,
      athensRssUtilization: toPercent,
      mongoRssUtilization: toPercent,
      monitoringRssUtilization: toPercent,
      otherRssUtilization: toPercent,
    }).map((point) => ({
      timestamp: String(point.timestamp),
      cpuPercent: (point.cpuUtilization as number) ?? null,
      memoryPercent: (point.memoryUtilization as number) ?? null,
      diskPercent: (point.diskUtilization as number) ?? null,
      loadPercent: (point.loadRatio as number) ?? null,
      uptimeSeconds: (point.uptimeSeconds as number) ?? null,
      memoryTotalBytes: (point.memoryTotalBytes as number) ?? null,
      athensRssPercent: (point.athensRssUtilization as number) ?? null,
      mongoRssPercent: (point.mongoRssUtilization as number) ?? null,
      monitoringRssPercent: (point.monitoringRssUtilization as number) ?? null,
      otherRssPercent: (point.otherRssUtilization as number) ?? null,
    }));
  }

  async readRamProcesses(
    options: PromOptions = {},
  ): Promise<RamProcessShare[]> {
    try {
      const [processData, totalData] = await Promise.all([
        this.query(TOP_PROCESS_MEMORY_BYTES, options),
        this.query('max(node_memory_MemTotal_bytes{job="node"})', options),
      ]);
      const total = Number(totalData.result?.[0]?.value?.[1]);
      const host = Number.isFinite(total) && total > 0 ? total : null;
      return (processData.result || [])
        .flatMap((row) => {
          const name = row.metric?.groupname;
          const bytes = Number(row.value?.[1]);
          if (!name || !Number.isFinite(bytes)) return [];
          return [
            {
              name,
              bytes,
              percent: host ? Math.round((bytes / host) * 1000) / 10 : 0,
            },
          ];
        })
        .sort((a, b) => b.bytes - a.bytes);
    } catch {
      return [];
    }
  }

  private healthRangeByComponent(
    severityData: Awaited<ReturnType<PrometheusClientService['queryRange']>>,
    availabilityData: Awaited<
      ReturnType<PrometheusClientService['queryRange']>
    >,
  ) {
    const result = new Map<
      string,
      { severity: Map<number, number>; availability: Map<number, number> }
    >();
    for (const series of severityData.result || []) {
      const component = series.metric?.component;
      if (!component) continue;
      const item = result.get(component) || {
        severity: new Map(),
        availability: new Map(),
      };
      for (const [timestamp, raw] of series.values || []) {
        item.severity.set(Number(timestamp), Number(raw));
      }
      result.set(component, item);
    }
    for (const series of availabilityData.result || []) {
      const component = series.metric?.component;
      if (!component) continue;
      const item = result.get(component) || {
        severity: new Map(),
        availability: new Map(),
      };
      for (const [timestamp, raw] of series.values || []) {
        item.availability.set(Number(timestamp), Number(raw));
      }
      result.set(component, item);
    }
    return result;
  }

  async readTodayTimeline(
    definitions: StatusComponentDef[],
    now = new Date(),
    bucketMinutes = 15,
    options: PromOptions = {},
  ) {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const [severityData, availabilityData] = await Promise.all([
      this.queryRange(
        'athens_health_severity',
        { start, end: now, step: 30 },
        options,
      ),
      this.queryRange(
        'athens_health_status',
        { start, end: now, step: 30 },
        options,
      ),
    ]);
    const source = this.healthRangeByComponent(severityData, availabilityData);
    const bucketSeconds = bucketMinutes * 60;
    const slotCount =
      Math.floor((now.getTime() - start.getTime()) / (bucketSeconds * 1000)) +
      1;
    return {
      startAt: start,
      endAt: now,
      bucketMinutes,
      components: definitions.map((definition) => {
        const series = source.get(definition.id);
        return {
          component: definition.id,
          name: definition.name,
          segments: Array.from({ length: slotCount }, (_, index) => {
            const timestamp = new Date(
              start.getTime() + index * bucketSeconds * 1000,
            );
            const lower = timestamp.getTime() / 1000;
            const upper = lower + bucketSeconds;
            const severityValues = [...(series?.severity.entries() || [])]
              .filter(([time]) => time >= lower && time < upper)
              .map(([, value]) => value);
            const known = severityValues.filter((value) => value < 4);
            const worst = known.length
              ? Math.max(...known)
              : severityValues.length
                ? 4
                : null;
            const availabilityValues = [
              ...(series?.availability.entries() || []),
            ]
              .filter(([time]) => time >= lower && time < upper)
              .map(([, value]) => value);
            return {
              timestamp,
              status:
                worst == null
                  ? 'unknown'
                  : SEVERITY_STATUS[Math.round(worst)] || 'unknown',
              availabilityPercent: availabilityValues.length
                ? (100 * availabilityValues.reduce((sum, v) => sum + v, 0)) /
                  availabilityValues.length
                : null,
              sampleCount: availabilityValues.length,
            };
          }),
        };
      }),
    };
  }

  async readDailyRollup(
    definitions: StatusComponentDef[],
    dateKey: string,
    options: PromOptions = {},
  ) {
    const start = new Date(`${dateKey}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const queryOptions = {
      ...options,
      time: end,
      timeoutMs: options.timeoutMs || PROMETHEUS_HISTORY_TIMEOUT_MS,
    };
    const [availabilityData, severityData, countData] = await Promise.all([
      this.query(HEALTH_DAILY_AVAILABILITY, queryOptions),
      this.query(HEALTH_DAILY_SEVERITY, queryOptions),
      this.query(HEALTH_DAILY_SAMPLE_COUNT, queryOptions),
    ]);
    return this.dailyRollupFromSeries(
      definitions,
      dateKey,
      this.scalarsByComponent(availabilityData),
      this.scalarsByComponent(severityData),
      this.scalarsByComponent(countData),
    );
  }

  private rangeByComponent(
    data: Awaited<ReturnType<PrometheusClientService['queryRange']>>,
  ) {
    const result = new Map<string, Map<number, number>>();
    for (const series of data.result || []) {
      const component = series.metric?.component;
      if (!component) continue;
      const points = result.get(component) || new Map();
      for (const [timestamp, raw] of series.values || []) {
        const value = Number(raw);
        if (Number.isFinite(value)) points.set(Number(timestamp), value);
      }
      result.set(component, points);
    }
    return result;
  }

  async readDailyHistoryRange(
    definitions: StatusComponentDef[],
    days: number,
    now = new Date(),
    options: PromOptions = {},
  ): Promise<DailyComponentRollup[]> {
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const queryOptions = {
      ...options,
      timeoutMs: options.timeoutMs || PROMETHEUS_HISTORY_TIMEOUT_MS,
    };
    const [availabilityData, severityData] = await Promise.all([
      this.queryRange(
        HEALTH_DAILY_AVAILABILITY,
        { start, end, step: 86400 },
        queryOptions,
      ),
      this.queryRange(
        HEALTH_DAILY_SEVERITY,
        { start, end, step: 86400 },
        queryOptions,
      ),
    ]);
    const availabilityByComponent = this.rangeByComponent(availabilityData);
    const severityByComponent = this.rangeByComponent(severityData);
    const timestamps = new Set<number>();
    for (const points of availabilityByComponent.values()) {
      for (const timestamp of points.keys()) timestamps.add(timestamp);
    }
    for (const points of severityByComponent.values()) {
      for (const timestamp of points.keys()) timestamps.add(timestamp);
    }
    return [...timestamps].flatMap((timestamp) => {
      const dateKey = new Date(timestamp * 1000 - 1).toISOString().slice(0, 10);
      const availability = new Map<string, number>();
      const severity = new Map<string, number>();
      for (const [component, points] of availabilityByComponent) {
        const value = points.get(timestamp);
        if (value != null && Number.isFinite(value)) {
          availability.set(component, value);
        }
      }
      for (const [component, points] of severityByComponent) {
        const value = points.get(timestamp);
        if (value != null && Number.isFinite(value)) {
          severity.set(component, value);
        }
      }
      return this.dailyRollupFromSeries(
        definitions,
        dateKey,
        availability,
        severity,
      ).components.filter(
        (row) => row.availabilityPercent != null || row.healthStatus,
      );
    });
  }

  async readDependencyMetrics(minutes = 60, options: PromOptions = {}) {
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60 * 1000);
    const step = stepForMinutes(minutes, 180);
    const entries = await Promise.all(
      Object.entries(DEPENDENCY_QUERIES).map(async ([dependency, queries]) => {
        const seriesEntries = await Promise.all(
          Object.entries(queries as Record<string, string>).map(
            async ([name, expression]) => {
              const data = await this.queryRange(
                expression,
                { start, end, step },
                options,
              );
              return [name, data.result?.[0] || null] as const;
            },
          ),
        );
        const points = this.mergeRangeSeries(Object.fromEntries(seriesEntries));
        return [
          dependency,
          {
            updatedAt: (points.at(-1)?.timestamp as string) || null,
            current: points.at(-1) || null,
            points,
            source: 'prometheus' as const,
            delayed: false,
            expectedDelaySeconds: 0,
          },
        ] as const;
      }),
    );
    return Object.fromEntries(entries);
  }
}
