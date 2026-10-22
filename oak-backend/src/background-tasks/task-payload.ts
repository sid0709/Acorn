import {
  MAIL_AI_LABEL_BACKLOG_MAX_MESSAGES,
  MAIL_AI_LABEL_MAX_MESSAGES,
  MAIL_AI_LABEL_SCOPES,
} from '../mail/constants/mail.constants';
import {
  BACKGROUND_TASK_TYPES,
  JOB_WORKER_POOL_MAX_IDS,
  RESUME_GENERATION_MAX_JOB_IDS,
} from './constants/task-types';

function normalizeMailAiLabelPayload(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (raw.scope === MAIL_AI_LABEL_SCOPES.UNLABELED_BACKLOG) {
    const requested = Number(raw.limit);
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), MAIL_AI_LABEL_BACKLOG_MAX_MESSAGES)
        : MAIL_AI_LABEL_BACKLOG_MAX_MESSAGES;
    return { scope: MAIL_AI_LABEL_SCOPES.UNLABELED_BACKLOG, limit };
  }

  const ids = Array.isArray(raw.messageIds)
    ? raw.messageIds.map((id) => String(id)).filter(Boolean)
    : [];
  if (!ids.length) {
    throw new Error('payload.messageIds is required for mail_ai_label');
  }
  // Truncating here used to drop the overflow silently, leaving those rows
  // running forever in the client with no result.
  if (ids.length > MAIL_AI_LABEL_MAX_MESSAGES) {
    throw new Error(
      `Select at most ${MAIL_AI_LABEL_MAX_MESSAGES} emails per run, or use All unlabeled to work through the backlog.`,
    );
  }
  return { scope: MAIL_AI_LABEL_SCOPES.SELECTION, messageIds: ids };
}

export function normalizeTaskPayload(
  type: string,
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const raw = payload && typeof payload === 'object' ? payload : {};
  if (type === BACKGROUND_TASK_TYPES.MAIL_AI_LABEL) {
    return normalizeMailAiLabelPayload(raw);
  }
  if (type === BACKGROUND_TASK_TYPES.RESUME_GENERATION) {
    const requestRecordIds = Array.isArray(raw.requestRecordIds)
      ? raw.requestRecordIds.map((id) => String(id)).filter(Boolean)
      : [];
    const jobIds = Array.isArray(raw.jobIds)
      ? [...new Set(raw.jobIds.map((id) => String(id)).filter(Boolean))].slice(
          0,
          RESUME_GENERATION_MAX_JOB_IDS,
        )
      : [];
    return {
      requestRecordIds,
      jobIds,
      deferPdf: raw.deferPdf === true,
      forceRegenerate: raw.forceRegenerate === true,
    };
  }
  if (type === BACKGROUND_TASK_TYPES.JOB_WORKER_POOL) {
    const jobIds = Array.isArray(raw.jobIds)
      ? [
          ...new Set(
            raw.jobIds.map((id) => String(id || '').trim()).filter(Boolean),
          ),
        ]
      : [];
    if (!jobIds.length) {
      throw new Error('payload.jobIds is required for job_worker_pool');
    }
    return {
      jobIds: jobIds.slice(0, JOB_WORKER_POOL_MAX_IDS),
      applyAllCompanyRoles: raw.applyAllCompanyRoles === true,
    };
  }
  return { ...raw };
}

export function initialTaskProgress(
  type: string,
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (type === BACKGROUND_TASK_TYPES.RESUME_GENERATION) {
    const jobIds = Array.isArray(payload.jobIds) ? payload.jobIds : [];
    if (jobIds.length) {
      return {
        total: jobIds.length,
        completed: 0,
        failed: 0,
        cancelled: 0,
        remaining: jobIds.length,
        active: 0,
        operation: 'job_search_resume_generation',
        items: Object.fromEntries(
          jobIds.map((id) => [String(id), { status: 'queued', step: null }]),
        ),
      };
    }
  }
  if (type !== BACKGROUND_TASK_TYPES.JOB_WORKER_POOL) return undefined;
  const jobIds = Array.isArray(payload.jobIds) ? payload.jobIds : [];
  const total = jobIds.length;
  return {
    total,
    completed: 0,
    failed: 0,
    remaining: total,
    active: 0,
    phase: 'queued',
    appliedIds: [],
    items: {},
  };
}

export function publicTaskSnapshot(task: {
  id: string;
  requestId?: string | null;
  type: string;
  status: string;
  profileId?: string | null;
  applierName?: string | null;
  progress?: unknown;
  result?: unknown;
  error?: string | null;
  createdAt?: Date | null;
  startedAt?: Date | null;
  cancelRequestedAt?: Date | null;
  cancelAcknowledgedAt?: Date | null;
  finishedAt?: Date | null;
  updatedAt?: Date | null;
}) {
  return {
    id: task.id,
    requestId: task.requestId ?? null,
    type: task.type,
    status: task.status,
    profileId: task.profileId ?? null,
    applierName: task.applierName ?? null,
    progress: task.progress ?? {},
    result: task.result ?? null,
    error: task.error ?? null,
    createdAt: task.createdAt?.toISOString?.() ?? null,
    startedAt: task.startedAt?.toISOString?.() ?? null,
    cancelRequestedAt: task.cancelRequestedAt?.toISOString?.() ?? null,
    cancelAcknowledgedAt: task.cancelAcknowledgedAt?.toISOString?.() ?? null,
    finishedAt: task.finishedAt?.toISOString?.() ?? null,
    updatedAt: task.updatedAt?.toISOString?.() ?? null,
  };
}
