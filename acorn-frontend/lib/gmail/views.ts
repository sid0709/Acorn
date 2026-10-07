import type { BadgeVariant, GlyphName } from "sid-ui";

import type { GmailLabel, GmailLabelColor, GmailRow } from "./types";

/** Rows per page, and the choices the pager offers. */
export const GMAIL_PAGE_SIZES = [10, 25, 50, 100];
export const GMAIL_DEFAULT_PAGE_SIZE = 25;
/** Longest search Gmail is sent; matches acorn-backend's limit. */
export const GMAIL_SEARCH_MAX = 500;
/** Wait this long after the last keystroke before searching Gmail. */
export const GMAIL_SEARCH_DEBOUNCE_MS = 300;
/** Opened message ids kept locally; older ones fall off. */
export const READ_MAIL_MAX = 2000;

export const INBOX = "INBOX";
export const UNREAD = "UNREAD";
/** "All mail" has no Gmail label; it lists everything outside Spam and Trash. */
export const ALL_MAIL = "ALL_MAIL";
/** Listing with no label reads every message. */
const NO_LABEL = "";

/** What a sidebar folder lists, and what its count means. */
export type GmailFolder = {
  /** The sidebar key: a Gmail label id, UNREAD, or ALL_MAIL. */
  key: string;
  title: string;
  glyph: GlyphName;
  /** The Gmail label the list reads; empty for every label. */
  labelId: string;
  /** Gmail search added to the label, e.g. "is:unread". */
  q: string;
  /** Which count the sidebar badge shows, from which label. */
  count?: { labelId: string; of: "unread" | "total" };
};

/** Gmail's folders in Gmail's order. Each shows when the account has that label. */
const SYSTEM_FOLDERS: GmailFolder[] = [
  {
    key: INBOX,
    title: "Inbox",
    glyph: "mail",
    labelId: INBOX,
    q: "",
    count: { labelId: INBOX, of: "unread" },
  },
  {
    key: UNREAD,
    title: "Unread",
    glyph: "dot",
    labelId: INBOX,
    q: "is:unread",
    count: { labelId: INBOX, of: "unread" },
  },
  { key: "STARRED", title: "Starred", glyph: "star", labelId: "STARRED", q: "" },
  { key: "SNOOZED", title: "Snoozed", glyph: "clock", labelId: "SNOOZED", q: "" },
  { key: "IMPORTANT", title: "Important", glyph: "bookmark", labelId: "IMPORTANT", q: "" },
  { key: "SENT", title: "Sent", glyph: "send", labelId: "SENT", q: "" },
  {
    key: "DRAFT",
    title: "Drafts",
    glyph: "file",
    labelId: "DRAFT",
    q: "",
    count: { labelId: "DRAFT", of: "total" },
  },
  { key: ALL_MAIL, title: "All mail", glyph: "archive", labelId: NO_LABEL, q: "" },
  {
    key: "SPAM",
    title: "Spam",
    glyph: "info",
    labelId: "SPAM",
    q: "",
    count: { labelId: "SPAM", of: "unread" },
  },
  { key: "TRASH", title: "Trash", glyph: "trash", labelId: "TRASH", q: "" },
];

/** Labels that are always there even when the label list leaves them out. */
const VIRTUAL_FOLDERS = new Set([UNREAD, ALL_MAIL]);

export function systemFolders(labels: GmailLabel[]): GmailFolder[] {
  // Before the labels load (or if they fail), show Gmail's usual folders.
  if (labels.length === 0) return SYSTEM_FOLDERS.filter((folder) => folder.key !== "SNOOZED");
  const present = new Set(labels.map((label) => label.id));
  return SYSTEM_FOLDERS.filter(
    (folder) => VIRTUAL_FOLDERS.has(folder.key) || present.has(folder.key),
  );
}

export function userFolder(label: GmailLabel): GmailFolder {
  return {
    key: label.id,
    title: label.name,
    glyph: "tag",
    labelId: label.id,
    q: "",
    count: { labelId: label.id, of: "unread" },
  };
}

/** Searching reads the whole mailbox, as Gmail does. */
export function searchFolder(search: string): GmailFolder {
  return {
    key: "",
    title: `Results for “${search}”`,
    glyph: "search",
    labelId: NO_LABEL,
    q: search,
  };
}

export function folderFor(key: string, labels: GmailLabel[]): GmailFolder {
  const system = SYSTEM_FOLDERS.find((folder) => folder.key === key);
  if (system) return system;
  const label = labels.find((item) => item.id === key);
  return label ? userFolder(label) : SYSTEM_FOLDERS[0];
}

/** A user label and the labels nested under it ("Jobs/Applied" sits under "Jobs"). */
export type LabelNode = { label: GmailLabel; leaf: string; children: LabelNode[] };

const LABEL_SEPARATOR = "/";

export function labelTree(labels: GmailLabel[]): LabelNode[] {
  const user = labels.filter((label) => label.type === "user");
  const byName = new Map(user.map((label) => [label.name, label]));
  const nodes = new Map<string, LabelNode>();
  const roots: LabelNode[] = [];
  for (const label of user) {
    const cut = label.name.lastIndexOf(LABEL_SEPARATOR);
    nodes.set(label.name, {
      label,
      leaf: cut >= 0 ? label.name.slice(cut + 1) : label.name,
      children: [],
    });
  }
  for (const label of user) {
    const node = nodes.get(label.name);
    const cut = label.name.lastIndexOf(LABEL_SEPARATOR);
    const parent =
      cut >= 0 && byName.has(label.name.slice(0, cut)) ? nodes.get(label.name.slice(0, cut)) : null;
    if (!node) continue;
    if (parent) parent.children.push(node);
    else roots.push({ ...node, leaf: label.name });
  }
  return roots;
}

const BADGE_FOR: Record<GmailLabelColor, BadgeVariant> = {
  "": "neutral",
  neutral: "neutral",
  red: "red",
  orange: "orange",
  yellow: "yellow",
  green: "green",
  teal: "teal",
  cyan: "cyan",
  blue: "blue",
  purple: "purple",
  pink: "pink",
};

export function labelBadge(label: GmailLabel): BadgeVariant {
  return BADGE_FOR[label.color] ?? "neutral";
}

/** The chip a row shows: its first user label (not the one being viewed), "+N" for more. */
export function rowChip(
  row: GmailRow,
  labels: Map<string, GmailLabel>,
  viewing: string,
): { label: string; variant: BadgeVariant } | undefined {
  const own = row.labelIds
    .filter((id) => id !== viewing)
    .map((id) => labels.get(id))
    .filter((label): label is GmailLabel => label?.type === "user");
  if (own.length === 0) return undefined;
  const extra = own.length - 1;
  return {
    label: extra > 0 ? `${own[0].name} +${extra}` : own[0].name,
    variant: labelBadge(own[0]),
  };
}

const MS_PER_DAY = 86_400_000;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Gmail style in the reader's time zone: "1:45 PM", "Yesterday", "Oct 6", "10/6/25". */
export function formatRowTime(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.round((startOfDay(now) - startOfDay(date)) / MS_PER_DAY);
  if (days <= 0) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, { year: "2-digit", month: "numeric", day: "numeric" });
}

/** "Oct 7, 2026, 10:28 AM" for the reader header. */
export function formatFullTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const BYTES_PER_KB = 1024;

export function formatSize(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_KB * BYTES_PER_KB) return `${Math.round(bytes / BYTES_PER_KB)} KB`;
  return `${(bytes / BYTES_PER_KB / BYTES_PER_KB).toFixed(1)} MB`;
}
