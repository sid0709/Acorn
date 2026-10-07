import { dayLabel } from "./format";
import { CLAIM_AUTHOR } from "./types";

import type { ClaimAuthor, SupportClaim, SupportMessage } from "./types";

/** Consecutive messages from one author on one day, shown under one name. */
export type MessageRun = {
  author: ClaimAuthor;
  name: string;
  day: string;
  messages: SupportMessage[];
};

/** The reporter's notes, shown as the conversation's first message. */
export function notesMessage(claim: SupportClaim): SupportMessage | null {
  const body = claim.notes.trim();
  if (!body) return null;
  return {
    id: `${claim.id}:notes`,
    author: CLAIM_AUTHOR.user,
    authorName: claim.userName,
    body,
    createdAt: claim.createdAt,
  };
}

/** Groups a claim's conversation (notes first) into runs. */
export function messageRuns(claim: SupportClaim, messages: SupportMessage[]): MessageRun[] {
  const notes = notesMessage(claim);
  const all = notes ? [notes, ...messages] : messages;
  const runs: MessageRun[] = [];
  for (const message of all) {
    const day = dayLabel(message.createdAt);
    const last = runs[runs.length - 1];
    if (last && last.author === message.author && last.day === day) {
      last.messages.push(message);
    } else {
      runs.push({ author: message.author, name: message.authorName, day, messages: [message] });
    }
  }
  return runs;
}

/** Where a bubble sits in its run, for rounded-corner grouping. */
export function bubblePosition(
  index: number,
  count: number,
): "first" | "middle" | "last" | undefined {
  if (count < 2) return undefined;
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}
