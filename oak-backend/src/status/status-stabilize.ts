import type { CheckResult } from './types/status.types';

export function stabilizeStatus(
  result: CheckResult,
  previous:
    { status?: string; rawStatus?: string; statusStreak?: number } | undefined,
  options: {
    warningSamples?: number;
    criticalSamples?: number;
    recoverySamples?: number;
  } = {},
): Pick<CheckResult, 'status' | 'message' | 'rawStatus' | 'statusStreak'> {
  const warningSamples =
    options.warningSamples ?? Number(process.env.MONITOR_WARNING_SAMPLES || 10);
  const criticalSamples =
    options.criticalSamples ??
    Number(process.env.MONITOR_CRITICAL_SAMPLES || 4);
  const recoverySamples =
    options.recoverySamples ??
    Number(process.env.MONITOR_RECOVERY_SAMPLES || 2);
  const rawStatus = result.status;
  const statusStreak =
    previous && previous.rawStatus === rawStatus
      ? (previous.statusStreak || 0) + 1
      : 1;
  let status = rawStatus;
  let message = result.message;

  if (
    rawStatus === 'degraded' &&
    statusStreak < warningSamples &&
    previous?.status !== 'degraded' &&
    previous?.status !== 'major_outage'
  ) {
    status = 'operational';
    message = 'Operating normally. A brief warning is being verified.';
  } else if (
    (rawStatus === 'partial_outage' || rawStatus === 'major_outage') &&
    statusStreak < criticalSamples &&
    previous?.status !== rawStatus
  ) {
    status = 'degraded';
    message = `A failure signal is being verified. ${result.message}`;
  } else if (
    rawStatus === 'operational' &&
    previous &&
    ['degraded', 'partial_outage', 'major_outage'].includes(
      previous.status || '',
    ) &&
    statusStreak < recoverySamples
  ) {
    status = previous.status || status;
    message = 'Service health is recovering; confirmation is in progress.';
  }

  return { status, message, rawStatus, statusStreak };
}

export function prepareStatusResults(
  results: CheckResult[],
  previousByComponent = new Map<string, CheckResult>(),
): CheckResult[] {
  return results.map((result) => {
    const stabilized = stabilizeStatus(
      result,
      previousByComponent.get(result.component),
    );
    return { ...result, ...stabilized };
  });
}

export function classifyVpsMetrics(metrics: {
  diskUtilization: number;
  memoryUtilization: number;
  cpuUtilization: number;
  loadRatio: number;
}): { status: string; message: string } {
  const critical =
    metrics.diskUtilization >= 0.9 ||
    metrics.memoryUtilization >= 0.95 ||
    metrics.cpuUtilization >= 0.95 ||
    metrics.loadRatio >= 1.5;
  const warning =
    metrics.diskUtilization >= 0.85 ||
    metrics.memoryUtilization >= 0.9 ||
    metrics.cpuUtilization >= 0.85 ||
    metrics.loadRatio >= 1;
  const warnings: string[] = [];
  if (metrics.diskUtilization >= 0.85) {
    warnings.push(`disk ${(metrics.diskUtilization * 100).toFixed(0)}%`);
  }
  if (metrics.memoryUtilization >= 0.9) {
    warnings.push(`memory ${(metrics.memoryUtilization * 100).toFixed(0)}%`);
  }
  if (metrics.cpuUtilization >= 0.85) {
    warnings.push(`CPU ${(metrics.cpuUtilization * 100).toFixed(0)}%`);
  }
  if (metrics.loadRatio >= 1) {
    warnings.push(`load per core ${(metrics.loadRatio * 100).toFixed(0)}%`);
  }
  return {
    status: critical || warning ? 'degraded' : 'operational',
    message: warnings.length
      ? `${critical ? 'Critical' : 'Sustained'} resource pressure: ${warnings.join(', ')}.`
      : 'Operating normally.',
  };
}
