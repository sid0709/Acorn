/**
 * Support claims as acorn-backend sends them (acornapi/support.go claimRow and
 * messageRow). The extension and acorn-admin both read these shapes.
 */

export const CLAIM_STATUS = { open: "open", closed: "closed" } as const;
export type ClaimStatus = (typeof CLAIM_STATUS)[keyof typeof CLAIM_STATUS];

/** What each status reads as. */
export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  open: "Opened",
  closed: "Closed",
};

/** Who wrote a message: the reporter or support. */
export const CLAIM_AUTHOR = { user: "user", admin: "admin" } as const;
export type ClaimAuthor = (typeof CLAIM_AUTHOR)[keyof typeof CLAIM_AUTHOR];

/** The name support's replies carry. The same string is supportAuthorName in acornapi. */
export const SUPPORT_NAME = "Acorn Support";

/** The longest notes and messages acorn-backend accepts (support.MaxNotesLen / MaxMessageLen). */
export const MAX_NOTES_LENGTH = 2000;
export const MAX_MESSAGE_LENGTH = 4000;

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
  messageCount: number;
  lastMessageAt: string;
  lastMessageBy: ClaimAuthor | "";
  /** The other side wrote since the reader last opened the claim. */
  unread: boolean;
  createdAt: string;
};

export type SupportMessage = {
  id: string;
  author: ClaimAuthor;
  authorName: string;
  body: string;
  createdAt: string;
};

export type ClaimThreadData = { claim: SupportClaim; messages: SupportMessage[] };

/** The reporter's routes on acorn-backend. */
export const SUPPORT_CLAIMS_PATH = "/acorn/support/claims";
export const supportClaimPath = (id: string) => `${SUPPORT_CLAIMS_PATH}/${encodeURIComponent(id)}`;
export const supportClaimMessagesPath = (id: string) => `${supportClaimPath(id)}/messages`;
export const supportClaimReadPath = (id: string) => `${supportClaimPath(id)}/read`;
