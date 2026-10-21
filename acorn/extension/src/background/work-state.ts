/** Tabs with an in-flight FAB pipeline (parallel across tabs; one per tab). */
export const pipelineRunningTabIds = new Set<number>();
/** Tabs a Run is working on (its start tab and any tab it claimed), in start order. */
export const runTabIds = new Set<number>();

export const KEEP_ALIVE_ALARM = "acorn-socket-keep-alive";
export const WORK_KEEP_ALIVE_ALARM = "acorn-work-keep-alive";

/** Set while the Agent tab's queue is working through its jobs, so the worker stays up between them. */
let queueDriving = false;

export function setQueueDriving(driving: boolean): void {
  queueDriving = driving;
  syncWorkKeepAlive();
}

export function anyTabWorking(): boolean {
  return pipelineRunningTabIds.size > 0 || queueDriving;
}

export function syncWorkKeepAlive(): void {
  if (anyTabWorking()) {
    void chrome.alarms.create(WORK_KEEP_ALIVE_ALARM, { periodInMinutes: 0.5 });
    return;
  }
  void chrome.alarms.clear(WORK_KEEP_ALIVE_ALARM);
}
