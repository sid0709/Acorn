import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_MESSAGE_LENGTH,
  type MessageDraft,
} from "./types";

/** Multipart field names acorn-backend reads (acornapi formBody, formPageURL, …). */
const MESSAGE_FORM = {
  body: "body",
  pageUrl: "pageUrl",
  pageTitle: "pageTitle",
  files: "files",
} as const;

/** What a file picker offers: the image types acorn-backend keeps. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_TYPES.join(",");

const MEGABYTE = 1 << 20;

/** A message as the multipart body acorn-backend reads. Send it without a Content-Type header. */
export function messageFormData(draft: MessageDraft): FormData {
  const form = new FormData();
  form.append(MESSAGE_FORM.body, draft.body);
  if (draft.pageUrl) form.append(MESSAGE_FORM.pageUrl, draft.pageUrl);
  if (draft.pageTitle) form.append(MESSAGE_FORM.pageTitle, draft.pageTitle);
  for (const file of draft.files) form.append(MESSAGE_FORM.files, file, file.name);
  return form;
}

/**
 * Splits picked, pasted, or dropped files into the images that can go along with what is
 * already attached, and why the rest can't.
 */
export function acceptImages(
  files: File[],
  attached: number,
): { accepted: File[]; problem: string } {
  const accepted: File[] = [];
  let problem = "";
  for (const file of files) {
    if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
      problem = "Only PNG, JPEG, GIF, or WebP images can be attached.";
    } else if (file.size > MAX_ATTACHMENT_BYTES) {
      problem = `Images must be under ${MAX_ATTACHMENT_BYTES / MEGABYTE} MB.`;
    } else if (attached + accepted.length >= MAX_ATTACHMENTS) {
      problem = `Attach up to ${MAX_ATTACHMENTS} images per message.`;
    } else {
      accepted.push(file);
    }
  }
  return { accepted, problem };
}

/** Why a draft can't be sent, or "" when it can. */
export function draftProblem(body: string, files: File[]): string {
  if (body.length > MAX_MESSAGE_LENGTH) {
    return `Keep messages under ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`;
  }
  return body || files.length ? "" : "Write a message or attach an image.";
}
