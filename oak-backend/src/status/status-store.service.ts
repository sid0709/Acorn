import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  STATUS_ROLLUP_BACKFILL_DAYS,
  STATUS_SOURCE,
  getComponentDefinitions,
  statusMessage,
} from './constants/status-components';
import { PrometheusClientService } from './prometheus-client.service';
import type {
  CheckResult,
  ComponentStatusRow,
  DailyComponentRollup,
  IncidentUpdate,
  PublicIncident,
} from './types/status.types';

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function defaultComponent(definition: {
  id: string;
  name: string;
}): ComponentStatusRow {
  return {
    component: definition.id,
    name: definition.name,
    status: 'unknown',
    message: 'No monitoring sample is available yet.',
    lastCheckedAt: null,
    lastSuccessAt: null,
    latencyMs: null,
    uptimePercent: null,
  };
}

function markStale(
  component: ComponentStatusRow,
  now = Date.now(),
  staleAfterMs = Number(process.env.MONITOR_STALE_AFTER_MS || 120000),
): ComponentStatusRow {
  const checkedAt = asDate(component?.lastCheckedAt)?.getTime() || 0;
  if (!component || !checkedAt || now - checkedAt <= staleAfterMs) {
    return component;
  }
  return {
    ...component,
    status: 'unknown',
    message: 'Monitoring data is stale.',
  };
}

function publicIncident(row: {
  id: string;
  component: string;
  name: string;
  status: string;
  severity: string;
  title: string;
  description: string;
  startedAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date;
  updates: unknown;
}): PublicIncident {
  const updates = Array.isArray(row.updates) ? row.updates : [];
  return {
    id: row.id,
    component: row.component,
    name: row.name,
    status: row.status,
    severity: row.severity,
    title: row.title,
    description: row.description,
    startedAt: asDate(row.startedAt),
    resolvedAt: asDate(row.resolvedAt),
    updatedAt: asDate(row.updatedAt),
    updates: (updates as IncidentUpdate[]).map((update) => ({
      ...update,
      createdAt: asDate(update.createdAt) || update.createdAt,
    })),
  };
}

function isIncidentStatus(status: string): boolean {
  return ['degraded', 'partial_outage', 'major_outage'].includes(status);
}

@Injectable()
export class StatusStoreService {
  private readonly logger = new Logger(StatusStoreService.name);
  private readonly rollupAttempts = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly prometheus: PrometheusClientService,
  ) {}

  async readCurrentStatus(): Promise<ComponentStatusRow[]> {
    const definitions = getComponentDefinitions();
    let fallback: { components?: ComponentStatusRow[] } | null = null;
    try {
      const snap = await this.prisma.monitorStatus.findUnique({
        where: { source: STATUS_SOURCE },
      });
      if (snap) {
        fallback = {
          components: Array.isArray(snap.components)
            ? (snap.components as unknown as ComponentStatusRow[])
            : [],
        };
      }
    } catch {
      fallback = null;
    }
    const fallbackById = new Map(
      (fallback?.components || []).map((component) => {
        const definition = definitions.find(
          (item) => item.id === component.component,
        );
        return [
          component.component,
          definition
            ? {
                ...defaultComponent(definition),
                ...markStale(component),
                name: definition.name,
              }
            : null,
        ] as const;
      }),
    );
    try {
      const live = await this.prometheus.readCurrentStatus(definitions);
      return definitions.map((definition) => {
        const current = live.get(definition.id);
        const stored = fallbackById.get(definition.id);
        if (!current) return stored || defaultComponent(definition);
        return {
          ...defaultComponent(definition),
          ...current,
          message:
            stored?.status === current.status
              ? stored.message
              : statusMessage(current.status),
          lastSuccessAt:
            current.status === 'operational'
              ? current.lastCheckedAt
              : stored?.lastSuccessAt || null,
        };
      });
    } catch {
      return definitions.map(
        (definition) =>
          fallbackById.get(definition.id) || defaultComponent(definition),
      );
    }
  }

  async readLiveMetrics(minutes: number) {
    return this.prometheus.readLiveMetrics(minutes);
  }

  async readRamProcesses() {
    return this.prometheus.readRamProcesses();
  }

  async readTodayTimelines() {
    return this.prometheus.readTodayTimeline(getComponentDefinitions());
  }

  async readDependencyMetrics(minutes: number) {
    return this.prometheus.readDependencyMetrics(minutes);
  }

  async readIncidents(limit = 20): Promise<PublicIncident[]> {
    const rows = await this.prisma.monitorIncident.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.max(limit, 20),
    });
    return rows.map(publicIncident).slice(0, limit);
  }

  async readDailyRollups(from: string, to: string) {
    const stored = await this.readStoredDailyRollups(from, to);
    const byKey = new Map(
      stored.map((row) => [`${row.component}:${row.date}`, row]),
    );
    try {
      const live = await this.prometheus.readDailyHistoryRange(
        getComponentDefinitions(),
        STATUS_ROLLUP_BACKFILL_DAYS,
      );
      for (const row of live) {
        const key = `${row.component}:${row.date}`;
        if (!byKey.has(key)) byKey.set(key, row);
      }
    } catch (error) {
      this.logger.warn(
        `Prometheus daily history unavailable: ${error instanceof Error ? error.message : error}`,
      );
    }
    return [...byKey.values()].sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.component.localeCompare(b.component),
    );
  }

  private async readStoredDailyRollups(from: string, to: string) {
    const rows = await this.prisma.monitorDay.findMany({
      where: {
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'asc' },
      take: 180,
    });
    return rows.flatMap((day) => {
      const components = Array.isArray(day.components)
        ? (day.components as Array<Record<string, unknown>>)
        : [];
      return components
        .map((component): DailyComponentRollup => ({
          date: day.date,
          component: String(component.component || ''),
          name: String(component.name || ''),
          sampleCount: Number(component.sampleCount) || 0,
          successCount: Number(component.successCount) || 0,
          availabilityPercent:
            typeof component.availabilityPercent === 'number'
              ? component.availabilityPercent
              : null,
          avgLatencyMs:
            typeof component.avgLatencyMs === 'number'
              ? component.avgLatencyMs
              : null,
          maxLatencyMs:
            typeof component.maxLatencyMs === 'number'
              ? component.maxLatencyMs
              : null,
          healthStatus: component.healthStatus
            ? String(component.healthStatus)
            : null,
          coveragePercent:
            typeof component.coveragePercent === 'number'
              ? component.coveragePercent
              : null,
        }))
        .filter(
          (row) =>
            row.sampleCount > 0 ||
            row.availabilityPercent != null ||
            row.healthStatus,
        );
    });
  }

  async recordChecks(results: CheckResult[], now = new Date()) {
    const existing = await this.prisma.monitorStatus.findUnique({
      where: { source: STATUS_SOURCE },
    });
    const previousData = existing
      ? {
          components: Array.isArray(existing.components)
            ? (existing.components as unknown as ComponentStatusRow[])
            : [],
          activeIncidentIds:
            existing.activeIncidentIds &&
            typeof existing.activeIncidentIds === 'object'
              ? (existing.activeIncidentIds as Record<string, string>)
              : {},
        }
      : { components: [], activeIncidentIds: {} as Record<string, string> };
    const previousById = new Map(
      previousData.components.map((c) => [c.component, c]),
    );
    const activeIncidentIds = { ...previousData.activeIncidentIds };

    const components: ComponentStatusRow[] = [];
    for (const result of results) {
      const previous = previousById.get(result.component);
      const lastSuccessAt = result.ok
        ? now
        : asDate(previous?.lastSuccessAt) || null;
      const activeId = activeIncidentIds[result.component];

      if (isIncidentStatus(result.status) && !activeId) {
        const created = await this.prisma.monitorIncident.create({
          data: {
            source: STATUS_SOURCE,
            component: result.component,
            name: result.name,
            status: result.status,
            severity: result.status === 'degraded' ? 'warning' : 'critical',
            title: `${result.name} is ${result.status.replaceAll('_', ' ')}`,
            description: result.message,
            internalReason: result.error || result.message,
            startedAt: now,
            resolvedAt: null,
            updates: [],
          },
        });
        activeIncidentIds[result.component] = created.id;
      } else if (isIncidentStatus(result.status) && activeId) {
        await this.prisma.monitorIncident.update({
          where: { id: activeId },
          data: {
            status: result.status,
            severity: result.status === 'degraded' ? 'warning' : 'critical',
            title: `${result.name} is ${result.status.replaceAll('_', ' ')}`,
            description: result.message,
          },
        });
      } else if (result.status === 'operational' && activeId) {
        await this.prisma.monitorIncident.update({
          where: { id: activeId },
          data: { status: 'resolved', resolvedAt: now },
        });
        delete activeIncidentIds[result.component];
      }

      components.push({
        component: result.component,
        name: result.name,
        status: result.status,
        message: result.message,
        lastCheckedAt: now,
        lastSuccessAt,
        latencyMs: result.latencyMs ?? null,
        uptimePercent: result.uptimePercent ?? null,
      });
    }

    await this.prisma.monitorStatus.upsert({
      where: { source: STATUS_SOURCE },
      create: {
        source: STATUS_SOURCE,
        version: 2,
        components: components,
        activeIncidentIds: activeIncidentIds,
      },
      update: {
        version: 2,
        components: components,
        activeIncidentIds: activeIncidentIds,
      },
    });
    return components;
  }

  async rollupDay(dateKey: string, force = false) {
    if (!force) {
      const existing = await this.prisma.monitorDay.findUnique({
        where: { date: dateKey },
      });
      if (existing?.complete) return existing;
      const lastAttempt = this.rollupAttempts.get(dateKey) || 0;
      if (Date.now() - lastAttempt < 60 * 60 * 1000) return null;
    }
    this.rollupAttempts.set(dateKey, Date.now());
    const rollup = await this.prometheus.readDailyRollup(
      getComponentDefinitions(),
      dateKey,
    );
    const hasData = rollup.components.some(
      (item) =>
        item.sampleCount > 0 ||
        item.availabilityPercent != null ||
        item.healthStatus,
    );
    if (!hasData) return null;
    return this.prisma.monitorDay.upsert({
      where: { date: dateKey },
      create: {
        date: dateKey,
        source: STATUS_SOURCE,
        version: 2,
        complete: rollup.complete,
        components: rollup.components,
      },
      update: {
        complete: rollup.complete,
        components: rollup.components,
      },
    });
  }

  async createManualIncident(input: {
    component: string;
    status: string;
    severity: string;
    title: string;
    description: string;
  }) {
    const definition = getComponentDefinitions().find(
      (item) => item.id === input.component,
    );
    if (!definition) throw new Error('Unknown status component');
    const now = new Date();
    const row = await this.prisma.monitorIncident.create({
      data: {
        source: STATUS_SOURCE,
        component: input.component,
        name: definition.name,
        status: input.status,
        severity: input.severity,
        title: input.title,
        description: input.description,
        startedAt: now,
        resolvedAt: input.status === 'resolved' ? now : null,
        updates: [
          {
            status: input.status,
            message: input.description,
            createdAt: now.toISOString(),
          },
        ],
        manual: true,
      },
    });
    return publicIncident(row);
  }

  async updateManualIncident(
    id: string,
    input: { status?: string | null; message?: string },
  ) {
    const existing = await this.prisma.monitorIncident.findUnique({
      where: { id },
    });
    if (!existing) return null;
    const now = new Date();
    const prevUpdates = Array.isArray(existing.updates)
      ? (existing.updates as IncidentUpdate[])
      : [];
    const updates = [
      ...prevUpdates,
      {
        ...(input.status ? { status: input.status } : {}),
        ...(input.message ? { message: input.message } : {}),
        createdAt: now.toISOString(),
      },
    ];
    const row = await this.prisma.monitorIncident.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.status === 'resolved' ? { resolvedAt: now } : {}),
        updates: updates,
      },
    });
    return publicIncident(row);
  }
}
