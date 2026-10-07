/** Shapes acorn-backend's Gmail routes return. Safe to import from client and server. */

export type GmailRow = {
  id: string;
  threadId: string;
  sender: string;
  senderEmail: string;
  subject: string;
  snippet: string;
  labelIds: string[];
  isUnread: boolean;
  /** ISO 8601, UTC. */
  receivedAt: string;
};

export type GmailPage = {
  messages: GmailRow[];
  /** Empty on the last page. */
  nextPageToken: string;
  resultSizeEstimate: number;
};

/** A hue family from the label's Gmail color, or "" when it has none. */
export type GmailLabelColor =
  | ""
  | "neutral"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "cyan"
  | "blue"
  | "purple"
  | "pink";

export type GmailLabel = {
  id: string;
  name: string;
  type: "system" | "user";
  unread: number;
  total: number;
  color: GmailLabelColor;
};

export type GmailProfile = { email: string; name: string; picture: string };

export type GmailOverview = { profile: GmailProfile; labels: GmailLabel[] };

export type GmailAttachment = { filename: string; mimeType: string; size: number };

export type GmailMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: { name: string; email: string };
  to: string;
  cc: string;
  replyTo: string;
  labelIds: string[];
  isUnread: boolean;
  receivedAt: string;
  /** The HTML body, with inline images folded in. Empty for plain-text mail. */
  html: string;
  text: string;
  attachments: GmailAttachment[];
};

/** A custom label's description, saved for Autolabel. */
export type LabelGuide = {
  labelId: string;
  description: string;
};

/** What one Autolabel run did to the selected page. */
export type AutolabelOutcome = {
  results: { messageId: string; labelId: string; applied: boolean }[];
  labeled: number;
  unmatched: number;
  failed: number;
};

/** What the list shows: a label (or all mail) narrowed by Gmail search syntax. */
export type GmailListQuery = {
  mailboxId: string;
  labelId: string;
  q: string;
  pageToken: string;
  pageSize: number;
};
