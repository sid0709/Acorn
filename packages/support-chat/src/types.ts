/**
 * Support claims as acorn-backend sends them (acornapi/support.go claimRow and
 * messageRow). The extension and acorn-admin both read these shapes.
 */

export const CLAIM_STATUS = { open: "open", closed: "closed" } as const;
export type ClaimStatus = (typeof CLAIM_STATUS)[keyof typeof CLAIM_STATUS];

/** What each status reads as. */
export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  open: "Open",
  closed: "Resolved",
};

/** Who wrote a message: the reporter or support. */
export const CLAIM_AUTHOR = { user: "user", admin: "admin" } as const;
export type ClaimAuthor = (typeof CLAIM_AUTHOR)[keyof typeof CLAIM_AUTHOR];

/** The name support's replies carry. The same string is supportAuthorName in acornapi. */
export const SUPPORT_NAME = "Acorn Support";

/** The longest notes and messages acorn-backend accepts (support.MaxNotesLen / MaxMessageLen). */
export const MAX_NOTES_LENGTH = 2000;
export const MAX_MESSAGE_LENGTH = 4000;

/** Images on one message, and the largest one (support.MaxAttachments / MaxAttachmentBytes). */
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 8 << 20;
/** The image types acorn-backend keeps; it checks the bytes, not the name. */
export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** A status change the conversation records (support.KindResolved / KindReopened). */
export const MESSAGE_KIND = { resolved: "resolved", reopened: "reopened" } as const;
export type MessageKind = (typeof MESSAGE_KIND)[keyof typeof MESSAGE_KIND];

export type SupportClaim = {
  id: string;
  accountId: string;
  userEmail: string;
  userName: string;
  pageUrl: string;
  pageTitle: string;
  notes: string;
  extensionVersion: string;
  tabKey: string;
  status: ClaimStatus;
  screenshotMime: string;
  screenshotWidth: number;
  screenshotHeight: number;
  /** Debug-run files stored with this report. Absent or zero when none was recorded. */
  debugLogFiles?: number;
  messageCount: number;
  lastMessageAt: string;
  lastMessageBy: ClaimAuthor | "";
  /** The other side wrote since the reader last opened the claim. */
  unread: boolean;
  createdAt: string;
};

export type SupportAttachment = {
  id: string;
  mime: string;
  name: string;
  size: number;
  width: number;
  height: number;
};

export type SupportMessage = {
  id: string;
  author: ClaimAuthor;
  authorName: string;
  /** Set when the line records a status change instead of carrying a message. */
  kind?: MessageKind | "";
  body: string;
  /** The page a follow-up was sent from. */
  pageUrl?: string;
  pageTitle?: string;
  attachments?: SupportAttachment[];
  createdAt: string;
};

/** A message on its way out: text, images, and (for a follow-up) the page it is about. */
export type MessageDraft = {
  body: string;
  files: File[];
  pageUrl?: string;
  pageTitle?: string;
};

export type ClaimThreadData = { claim: SupportClaim; messages: SupportMessage[] };

/** The reporter's routes on acorn-backend. */
export const SUPPORT_CLAIMS_PATH = "/acorn/support/claims";
export const supportClaimPath = (id: string) => `${SUPPORT_CLAIMS_PATH}/${encodeURIComponent(id)}`;
export const supportClaimMessagesPath = (id: string) => `${supportClaimPath(id)}/messages`;
export const supportClaimReadPath = (id: string) => `${supportClaimPath(id)}/read`;
export const supportClaimReopenPath = (id: string) => `${supportClaimPath(id)}/reopen`;
export const supportClaimAttachmentPath = (id: string, attachmentId: string) =>
  `${supportClaimPath(id)}/attachments/${encodeURIComponent(attachmentId)}`;
