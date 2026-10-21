import type { AcornNoticeKind, AcornNoticePayload } from "../types";
import type { DescribedMessage, NoticeAction, NoticeTone } from "@acorn/shared/user-messages";

type PushFn = (notice: AcornNoticePayload) => void;
type ClearFn = (tabId: number) => void;
type ActionFn = (action: NoticeAction, tabId: number | undefined) => void;

let pushImpl: PushFn | null = null;
let clearImpl: ClearFn | null = null;
let actionImpl: ActionFn | null = null;

/**
 * Time on screen, by tone, for a notice that does not wait on the person; one that does (`sticky`) stays
 * until it is acted on, dismissed, or the run on its tab moves on. The run card keeps the full detail.
 */
const NOTICE_HOLD_MS: Record<NoticeTone, number> = {
  success: 5000,
  accent: 6000,
  neutral: 6000,
  warning: 8000,
  danger: 8000,
};

/** A notice's tone when only its kind is given. */
export const KIND_TONE: Record<AcornNoticeKind, NoticeTone> = {
  success: "success",
  info: "accent",
  error: "danger",
};

/** A notice's kind (the companion face's mood) from its tone. */
function kindOf(tone: NoticeTone): AcornNoticeKind {
  if (tone === "success") return "success";
  if (tone === "danger" || tone === "warning") return "error";
  return "info";
}

export function bindAcornNoticePush(fn: PushFn): () => void {
  pushImpl = fn;
  return () => {
    if (pushImpl === fn) pushImpl = null;
  };
}

export function pushAcornNotice(notice: AcornNoticePayload): void {
  pushImpl?.(notice);
}

/** The host takes a tab's notice off the screen (its run moved on). */
export function bindAcornNoticeClear(fn: ClearFn): () => void {
  clearImpl = fn;
  return () => {
    if (clearImpl === fn) clearImpl = null;
  };
}

export function clearAcornNotices(tabId: number): void {
  clearImpl?.(tabId);
}

/** The sidebar runs a notice's buttons (Continue, Open profile, …) on the notice's tab. */
export function bindNoticeActions(fn: ActionFn): () => void {
  actionImpl = fn;
  return () => {
    if (actionImpl === fn) actionImpl = null;
  };
}

export function runNoticeAction(action: NoticeAction, tabId: number | undefined): void {
  actionImpl?.(action, tabId);
}

/** How long a notice stays: 0 keeps it until it is acted on or dismissed. */
export function noticeDuration(notice: AcornNoticePayload): number {
  if (notice.sticky) return 0;
  return NOTICE_HOLD_MS[notice.tone ?? KIND_TONE[notice.kind]];
}

/** A catalogue message (user-messages.ts) as a notice. */
export function noticeOf(said: DescribedMessage): AcornNoticePayload {
  return {
    kind: kindOf(said.tone),
    tone: said.tone,
    glyph: said.glyph,
    title: said.title,
    detail: said.detail,
    actions: said.actions,
    sticky: said.sticky,
  };
}
