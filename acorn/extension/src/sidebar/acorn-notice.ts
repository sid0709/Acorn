import type { AcornNoticeKind, AcornNoticePayload } from "../types";

type PushFn = (notice: AcornNoticePayload) => void;

let pushImpl: PushFn | null = null;

/** Time on screen: every notice is gone within 4 s; the run card keeps the full detail. */
const NOTICE_HOLD_MS = {
  success: 3000,
  info: 4000,
  error: 4000,
} as const;

export function bindAcornNoticePush(fn: PushFn): () => void {
  pushImpl = fn;
  return () => {
    if (pushImpl === fn) pushImpl = null;
  };
}

export function pushAcornNotice(notice: AcornNoticePayload): void {
  pushImpl?.(notice);
}

export function noticeKindDuration(kind: AcornNoticeKind): number {
  return NOTICE_HOLD_MS[kind];
}
