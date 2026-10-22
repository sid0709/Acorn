type Sample = { name: string; labels: Record<string, string>; value: number };

const gauges = new Map<string, Sample>();
const counters = new Map<string, Sample>();

function key(name: string, labels: Record<string, string> = {}): string {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${name}|${parts}`;
}

function labelsText(labels: Record<string, string> = {}): string {
  const entries = Object.entries(labels);
  if (!entries.length) return '';
  return `{${entries
    .map(
      ([name, value]) =>
        `${name}="${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`,
    )
    .join(',')}}`;
}

export function setGauge(
  name: string,
  labels: Record<string, string>,
  value: number,
): void {
  gauges.set(key(name, labels), {
    name,
    labels,
    value: Number(value) || 0,
  });
}

export function incrementCounter(
  name: string,
  labels: Record<string, string>,
  value = 1,
): void {
  const k = key(name, labels);
  const current = counters.get(k);
  counters.set(k, {
    name,
    labels,
    value: (current?.value || 0) + value,
  });
}

export function setHealthMetric(component: string, healthy: boolean): void {
  setGauge('athens_health_status', { component }, healthy ? 1 : 0);
}

function emitProcessMemory(): void {
  const mem = process.memoryUsage();
  setGauge('athens_process_resident_memory_bytes', {}, mem.rss);
  setGauge('athens_process_heap_used_bytes', {}, mem.heapUsed);
  setGauge('athens_process_heap_total_bytes', {}, mem.heapTotal);
  setGauge('athens_process_external_bytes', {}, mem.external);
}

export function setHealthStateMetrics(
  component: string,
  status: string,
  checkedAt: Date = new Date(),
): void {
  const statuses = [
    'operational',
    'degraded',
    'partial_outage',
    'major_outage',
    'maintenance',
    'unknown',
  ];
  const severity: Record<string, number> = {
    operational: 0,
    degraded: 1,
    maintenance: 1,
    partial_outage: 2,
    major_outage: 3,
    unknown: 4,
  };
  for (const candidate of statuses) {
    setGauge(
      'athens_health_state',
      { component, status: candidate },
      candidate === status ? 1 : 0,
    );
  }
  setGauge('athens_health_severity', { component }, severity[status] ?? 4);
  setGauge(
    'athens_health_check_timestamp_seconds',
    { component },
    checkedAt.getTime() / 1000,
  );
}

export function renderMetrics(service = 'athens-backend'): string {
  emitProcessMemory();
  const lines = [
    '# HELP athens_metrics_exporter_info Athens application metrics exporter.',
    '# TYPE athens_metrics_exporter_info gauge',
    `athens_metrics_exporter_info{service="${service}"} 1`,
  ];
  const declared = new Set(['athens_metrics_exporter_info']);
  for (const item of [...counters.values(), ...gauges.values()]) {
    if (!declared.has(item.name)) {
      lines.push(
        `# TYPE ${item.name} ${counters.has(key(item.name, item.labels)) ? 'counter' : 'gauge'}`,
      );
      declared.add(item.name);
    }
    lines.push(`${item.name}${labelsText(item.labels)} ${item.value}`);
  }
  return `${lines.join('\n')}\n`;
}
