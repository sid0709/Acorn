export const JOB_STATUS_STATES = Object.freeze([
  'posted',
  'bid-ready',
  'worker-pool',
  'bid-completed',
  'applied',
  'scheduled',
  'declined',
]);

const STATUS_DATE_FIELDS = Object.freeze([
  'appliedDate',
  'scheduledDate',
  'declinedDate',
  'bidReadyDate',
  'bidCompletedDate',
]);

function dateMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value?.toDate === 'function')
    return value.toDate().getTime();
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function normalizedProfileId(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value && '$oid' in value)
    return String(value.$oid);
  return String(value);
}

function shouldReplace(field, current, candidate) {
  if (!current) return true;
  const currentTime = dateMillis(current);
  const candidateTime = dateMillis(candidate);
  if (field === 'appliedDate' || field === 'bidReadyDate') {
    return candidateTime < currentTime;
  }
  return candidateTime > currentTime;
}

/** Merge duplicate rows for one profile without changing another profile's state. */
export function mergeJobStatusRows(rows, profileId = null) {
  const expectedProfileId =
    profileId == null ? null : normalizedProfileId(profileId);
  let merged = null;
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== 'object') continue;
    const rowProfileId = normalizedProfileId(raw.applier);
    if (expectedProfileId != null && rowProfileId !== expectedProfileId)
      continue;
    if (!merged) merged = { applier: raw.applier };
    for (const field of STATUS_DATE_FIELDS) {
      if (!raw[field]) continue;
      if (shouldReplace(field, merged[field], raw[field])) {
        merged[field] = raw[field];
      }
    }
  }
  if (merged?.scheduledDate && merged?.declinedDate) {
    if (dateMillis(merged.scheduledDate) >= dateMillis(merged.declinedDate)) {
      delete merged.declinedDate;
    } else {
      delete merged.scheduledDate;
    }
  }
  return merged;
}

/** Resolve exactly one active state from the canonical embedded status row. */
export function resolveJobStatusState(statusOrRows, profileId = null) {
  const row = Array.isArray(statusOrRows)
    ? mergeJobStatusRows(statusOrRows, profileId)
    : statusOrRows;
  if (!row || typeof row !== 'object') return 'posted';

  if (row.scheduledDate && row.declinedDate) {
    return dateMillis(row.scheduledDate) >= dateMillis(row.declinedDate)
      ? 'scheduled'
      : 'declined';
  }
  if (row.scheduledDate) return 'scheduled';
  if (row.declinedDate) return 'declined';
  if (row.appliedDate) return 'applied';
  if (row.bidCompletedDate) return 'bid-completed';
  if (row.bidReadyDate) return 'bid-ready';
  return 'posted';
}

export function jobStatusContribution(statusOrRows, profileId = null) {
  const state = resolveJobStatusState(statusOrRows, profileId);
  const active = state !== 'posted';
  return {
    any: Number(active),
    rawApplied: Number(['applied', 'scheduled', 'declined'].includes(state)),
    applied: Number(state === 'applied'),
    scheduled: Number(state === 'scheduled'),
    declined: Number(state === 'declined'),
    'bid-ready': Number(state === 'bid-ready'),
    'worker-pool': Number(state === 'worker-pool'),
    'bid-completed': Number(state === 'bid-completed'),
  };
}

export function statusRowForProfile(rows, profileId) {
  return mergeJobStatusRows(rows, profileId);
}
