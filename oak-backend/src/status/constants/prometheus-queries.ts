export const DEFAULT_PROMETHEUS_URL = 'http://prometheus:9090';
export const PROMETHEUS_REQUEST_TIMEOUT_MS = 5000;
export const PROMETHEUS_HISTORY_TIMEOUT_MS = 15000;

/** One UTC day of health samples at the 30s scrape interval. */
export const HEALTH_DAY_EXPECTED_SAMPLES = 24 * 60 * 2;

export const HEALTH_DAILY_AVAILABILITY =
  'avg by (component) (avg_over_time(athens_health_status[1d]))';
export const HEALTH_DAILY_SEVERITY =
  'max by (component) (max_over_time((athens_health_severity < 4)[1d]))';
export const HEALTH_DAILY_SAMPLE_COUNT =
  'max by (component) (count_over_time(athens_health_status[1d]))';

/**
 * Available-aware host memory used ratio from node-exporter.
 * Computed inline (not via recording rule) so /status cannot invert
 * MemAvailable/MemTotal as "used" if recorded series drift.
 */
export const NODE_MEMORY_USED_RATIO =
  'max(1 - (node_memory_MemAvailable_bytes{job="node"} / node_memory_MemTotal_bytes{job="node"}))';

const HOST_MEMORY_TOTAL_BYTES = 'max(node_memory_MemTotal_bytes{job="node"})';

const MONITORING_PROCESS_GROUPS =
  'prometheus|grafana|cadvisor|alertmanager|node-exporter|blackbox-exporter|process-exporter';

/** Docker working set, deduped per container id. Matches name, image, or id. */
function cadvisorWorkingSetBytes(pattern: string): string {
  return `sum(max by (id) (
  container_memory_working_set_bytes{name=~"${pattern}",name!="/"}
  or
  container_memory_working_set_bytes{image=~"${pattern}",name!="/"}
  or
  container_memory_working_set_bytes{id=~"${pattern}",id!="/",name!="/"}
))`;
}

function processRssBytes(groupPattern: string): string {
  return `sum(namedprocess_namegroup_memory_bytes{groupname=~"${groupPattern}",memtype="resident"})`;
}

/**
 * Prefer process-exporter RSS (same source as MongoDB).
 * cAdvisor is a fallback when names/images happen to match.
 */
function attributedMemoryBytes(
  processGroup: string,
  cadvisorPattern: string,
): string {
  return `(
  ${processRssBytes(processGroup)}
  or
  ${cadvisorWorkingSetBytes(cadvisorPattern)}
)`;
}

/** App Node processes (API + worker). */
export const ATHENS_MEMORY_BYTES = attributedMemoryBytes(
  'athens',
  '.*nextoffer.*',
);

/**
 * Host mongod RSS, else a mongo Docker container.
 * `or` prefers process-exporter so a containerized mongod is not double-counted.
 */
export const MONGO_MEMORY_BYTES = attributedMemoryBytes(
  'mongod',
  '.*([Mm]ongo).*',
);

export const MONITORING_MEMORY_BYTES = attributedMemoryBytes(
  MONITORING_PROCESS_GROUPS,
  `.*(${MONITORING_PROCESS_GROUPS}).*`,
);

function shareOfHost(bytesExpr: string): string {
  return `(${bytesExpr}) / ${HOST_MEMORY_TOTAL_BYTES}`;
}

/** Host used minus the three measured groups. Missing groups count as 0. */
export const OTHER_MEMORY_RATIO = `clamp_min(
  ${NODE_MEMORY_USED_RATIO}
  - ((${ATHENS_MEMORY_BYTES}) or on() vector(0)) / ${HOST_MEMORY_TOTAL_BYTES}
  - ((${MONGO_MEMORY_BYTES}) or on() vector(0)) / ${HOST_MEMORY_TOTAL_BYTES}
  - ((${MONITORING_MEMORY_BYTES}) or on() vector(0)) / ${HOST_MEMORY_TOTAL_BYTES}
, 0)`;

export const VPS_QUERIES = {
  cpuUtilization: 'max(athens:node_cpu_utilization:ratio)',
  memoryUtilization: NODE_MEMORY_USED_RATIO,
  diskUtilization: 'max(athens:root_filesystem_utilization:ratio)',
  loadRatio: 'max(athens:node_load_utilization:ratio)',
  uptimeSeconds: 'max(athens:node_uptime_seconds)',
  scrapeAgeSeconds: 'time() - max(timestamp(node_uname_info{job="node"}))',
} as const;

export const TOP_PROCESS_MEMORY_BYTES =
  'topk(12, namedprocess_namegroup_memory_bytes{memtype="resident"})';

export const LIVE_VPS_QUERIES = {
  ...Object.fromEntries(
    Object.entries(VPS_QUERIES).filter(([name]) => name !== 'scrapeAgeSeconds'),
  ),
  memoryTotalBytes: HOST_MEMORY_TOTAL_BYTES,
  athensRssUtilization: shareOfHost(ATHENS_MEMORY_BYTES),
  mongoRssUtilization: shareOfHost(MONGO_MEMORY_BYTES),
  monitoringRssUtilization: shareOfHost(MONITORING_MEMORY_BYTES),
  otherRssUtilization: OTHER_MEMORY_RATIO,
};

/** Dependency series after Algolia / Firestore removal. */
export const DEPENDENCY_QUERIES = {
  'background-tasks': {
    oldestQueueAgeSeconds: 'max(athens_background_queue_oldest_age_seconds)',
    expiredLeaseCount: 'max(athens_background_expired_lease_count)',
  },
} as const;

export const SEVERITY_STATUS = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'unknown',
] as const;

export function stepForMinutes(minutes: number, maxPoints = 240): number {
  return Math.max(30, Math.ceil((minutes * 60) / maxPoints));
}
