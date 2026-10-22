export type CanonicalJobStatusState =
  | 'posted'
  | 'bid-ready'
  | 'worker-pool'
  | 'bid-completed'
  | 'applied'
  | 'scheduled'
  | 'declined';

export interface CanonicalJobStatusRow {
  applier: unknown;
  appliedDate?: unknown;
  scheduledDate?: unknown;
  declinedDate?: unknown;
  bidReadyDate?: unknown;
  bidCompletedDate?: unknown;
}

export const JOB_STATUS_STATES: readonly CanonicalJobStatusState[];
export function mergeJobStatusRows(
  rows: unknown[],
  profileId?: unknown,
): CanonicalJobStatusRow | null;
export function resolveJobStatusState(
  statusOrRows: CanonicalJobStatusRow | unknown[] | null | undefined,
  profileId?: unknown,
): CanonicalJobStatusState;
export function jobStatusContribution(
  statusOrRows: CanonicalJobStatusRow | unknown[] | null | undefined,
  profileId?: unknown,
): Record<
  | 'any'
  | 'rawApplied'
  | 'applied'
  | 'scheduled'
  | 'declined'
  | 'bid-ready'
  | 'worker-pool'
  | 'bid-completed',
  number
>;
export function statusRowForProfile(
  rows: unknown[],
  profileId: unknown,
): CanonicalJobStatusRow | null;
