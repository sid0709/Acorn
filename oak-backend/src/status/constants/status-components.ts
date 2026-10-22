/** Protocol component ids for public /status contracts. */
export const STATUS_SOURCE = 'production';

export type StatusComponentDef = {
  id: string;
  name: string;
  failureStatus: 'degraded' | 'partial_outage' | 'major_outage';
};

export const STATUS_COMPONENTS: readonly StatusComponentDef[] = [
  {
    id: 'athens-web',
    name: 'Athens web application',
    failureStatus: 'major_outage',
  },
  {
    id: 'athens-api',
    name: 'Athens API',
    failureStatus: 'major_outage',
  },
  {
    id: 'background-tasks',
    name: 'Background task workers',
    failureStatus: 'degraded',
  },
  {
    id: 'vps',
    name: 'VPS infrastructure',
    failureStatus: 'degraded',
  },
  {
    id: 'public-api',
    name: 'Public API request path',
    failureStatus: 'major_outage',
  },
] as const;

export const STATUS_PRIORITY: Record<string, number> = {
  operational: 0,
  unknown: 1,
  maintenance: 2,
  degraded: 3,
  partial_outage: 4,
  major_outage: 5,
};

export const LIVE_MINUTES = [15, 60, 360, 1440] as const;

/** Public status history window. Durable days live in Mongo; Prometheus only retains 14d. */
export const STATUS_HISTORY_DAYS = 90;
export const STATUS_ROLLUP_BACKFILL_DAYS = 14;

export const INCIDENT_STATES = [
  'detected',
  'investigating',
  'identified',
  'monitoring',
  'resolved',
] as const;

export function getComponentDefinitions(): StatusComponentDef[] {
  return STATUS_COMPONENTS.map((c) => ({ ...c }));
}

export function statusMessage(status: string): string {
  if (status === 'operational') return 'Operating normally.';
  if (status === 'degraded') {
    return 'The dependency is degraded; fallback behavior remains available.';
  }
  if (status === 'partial_outage') {
    return 'Part of this service is currently unavailable.';
  }
  if (status === 'major_outage') {
    return 'This service is currently unavailable.';
  }
  if (status === 'maintenance') return 'Maintenance is in progress.';
  return 'Monitoring data is unavailable or stale.';
}

export function overallStatus(components: Array<{ status: string }>): string {
  if (components.some((item) => item.status === 'major_outage')) {
    return 'major_outage';
  }
  if (components.some((item) => item.status === 'partial_outage')) {
    return 'partial_outage';
  }
  if (components.some((item) => item.status === 'degraded')) return 'degraded';
  if (components.some((item) => item.status === 'unknown')) return 'unknown';
  return 'operational';
}
