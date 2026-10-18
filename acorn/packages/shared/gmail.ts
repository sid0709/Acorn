/**
 * Gmail on Acorn: one OAuth connection per account, done on acorn-frontend under
 * Connections. The extension and the website both call the same acorn-backend routes
 * with the same Acorn session token; nothing connects Gmail inside the extension.
 */

/** acorn-backend Gmail and run routes (same paths the website uses). */
export const ACORN_GMAIL_API = {
  mailboxes: "/acorn/gmail/mailboxes",
  messages: "/acorn/gmail/messages",
  overview: "/acorn/gmail/overview",
  labelGuides: "/acorn/gmail/label-guides",
  autolabel: "/acorn/gmail/autolabel",
  mailVerification: "/acorn/run/mail-verification",
} as const;

/** acorn-frontend route where the user connects or manages Gmail. */
export const ACORN_GMAIL_CONNECT_PATH = "/connections/gmail";

export function acornGmailConnectUrl(webOrigin: string): string {
  return `${webOrigin.replace(/\/$/, "")}${ACORN_GMAIL_CONNECT_PATH}`;
}

/** One mailbox row from GET /acorn/gmail/mailboxes. */
export type AcornGmailMailbox = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  label?: string;
  isDefault?: boolean;
  watchesApplications?: boolean;
  canModify?: boolean;
  connectedAt?: string;
};

export type AcornGmailMailboxesResponse = {
  mailboxes?: AcornGmailMailbox[];
};
