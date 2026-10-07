"use server";

import type { MailMessage } from "@/lib/workspace/mail";
import type { Mailbox } from "@/lib/workspace/model";
import { acornApiUrl } from "@/lib/config";
import { sessionToken } from "@/lib/auth/cookie";

export type GmailCall<T> = { ok: true; data: T } | { ok: false; message: string };

type ErrorBody = { message?: string; error?: string };

async function authed(path: string, init?: RequestInit): Promise<Response | GmailCall<never>> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: "Sign in required." };
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${acornApiUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  }).catch(() => null);
  if (!response)
    return { ok: false, message: "Couldn’t reach Acorn. Check that the API is running." };
  return response;
}

async function read<T>(path: string, init?: RequestInit): Promise<GmailCall<T>> {
  const response = await authed(path, init);
  if (!(response instanceof Response)) return response;
  const data = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) return { ok: false, message: data.message || data.error || "Request failed." };
  return { ok: true, data };
}

type MailboxRow = {
  id: string;
  email: string;
  label: string;
  isDefault: boolean;
  watchesApplications: boolean;
  connectedAt: string;
};

function toMailbox(row: MailboxRow): Mailbox {
  return {
    id: row.id,
    email: row.email,
    label: row.label,
    isDefault: row.isDefault,
    watchesApplications: row.watchesApplications,
    connectedAt: row.connectedAt,
  };
}

export async function loadGmailMailboxes(): Promise<GmailCall<Mailbox[]>> {
  const result = await read<{ mailboxes: MailboxRow[] }>("/acorn/gmail/mailboxes");
  if (!result.ok) return result;
  return { ok: true, data: result.data.mailboxes.map(toMailbox) };
}

export async function loadGmailMessages(mailboxId: string): Promise<GmailCall<MailMessage[]>> {
  const query = new URLSearchParams({ mailboxId });
  const result = await read<{ messages: MailMessage[] }>(`/acorn/gmail/messages?${query}`);
  if (!result.ok) return result;
  return { ok: true, data: result.data.messages };
}

export async function disconnectGmailMailbox(mailboxId: string): Promise<GmailCall<true>> {
  const result = await read<{ success: boolean }>(`/acorn/gmail/mailboxes/${mailboxId}`, {
    method: "DELETE",
  });
  if (!result.ok) return result;
  return { ok: true, data: true };
}

export async function patchGmailMailbox(
  mailboxId: string,
  patch: { isDefault?: boolean; watchesApplications?: boolean },
): Promise<GmailCall<Mailbox>> {
  const result = await read<{ mailbox: MailboxRow }>(`/acorn/gmail/mailboxes/${mailboxId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!result.ok) return result;
  return { ok: true, data: toMailbox(result.data.mailbox) };
}
