"use client";

import { messageFormData, type MessageDraft, type SupportMessage } from "@acorn/support-chat";

import { ROUTES } from "../routes";

type SendAnswer = { message?: SupportMessage; error?: string };

/** Sends a reply with its images through the console's route; throws with the API's message. */
export async function sendClaimMessage(id: string, draft: MessageDraft): Promise<SupportMessage> {
  const res = await fetch(ROUTES.claimMessages(id), {
    method: "POST",
    credentials: "same-origin",
    body: messageFormData(draft),
  });
  const body = (await res.json().catch(() => ({}))) as SendAnswer;
  if (!res.ok || !body.message) throw new Error(body.error || `Couldn’t send (${res.status})`);
  return body.message;
}
