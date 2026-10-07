"use server";

import type { Mailbox } from "@/lib/workspace/model";

import { GMAIL_BACKEND, readGmail } from "./backend";

export type GmailResult<T> = { ok: true; data: T } | { ok: false; message: string };

type MailboxRow = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  label: string;
  isDefault: boolean;
  watchesApplications: boolean;
  connectedAt: string;
};

function toMailbox(row: MailboxRow): Mailbox {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? "",
    picture: row.picture ?? "",
    label: row.label,
    isDefault: row.isDefault,
    watchesApplications: row.watchesApplications,
    connectedAt: row.connectedAt,
  };
}

export async function loadGmailMailboxes(): Promise<GmailResult<Mailbox[]>> {
  const result = await readGmail<{ mailboxes: MailboxRow[] }>(GMAIL_BACKEND.mailboxes);
  if (!result.ok) return result;
  return { ok: true, data: result.data.mailboxes.map(toMailbox) };
}

export async function disconnectGmailMailbox(mailboxId: string): Promise<GmailResult<true>> {
  const result = await readGmail<{ success: boolean }>(
    `${GMAIL_BACKEND.mailboxes}/${encodeURIComponent(mailboxId)}`,
    { method: "DELETE" },
  );
  if (!result.ok) return result;
  return { ok: true, data: true };
}

export async function patchGmailMailbox(
  mailboxId: string,
  patch: { isDefault?: boolean; watchesApplications?: boolean },
): Promise<GmailResult<Mailbox>> {
  const result = await readGmail<{ mailbox: MailboxRow }>(
    `${GMAIL_BACKEND.mailboxes}/${encodeURIComponent(mailboxId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  if (!result.ok) return result;
  return { ok: true, data: toMailbox(result.data.mailbox) };
}
