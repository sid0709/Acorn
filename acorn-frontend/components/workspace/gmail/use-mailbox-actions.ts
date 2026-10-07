"use client";

import { useRouter } from "next/navigation";

import { disconnectGmailMailbox, patchGmailMailbox } from "@/lib/gmail/api";
import type { Mailbox } from "@/lib/workspace/model";

/** Saves the mailbox manager's edits to acorn-backend, then reloads the page data. */
export function useMailboxActions(connected: Mailbox[]) {
  const router = useRouter();

  return async (next: Mailbox[]) => {
    const removed = connected.find((box) => !next.some((item) => item.id === box.id));
    if (removed) {
      const result = await disconnectGmailMailbox(removed.id);
      if (result.ok) router.refresh();
      return;
    }
    for (const box of next) {
      const before = connected.find((item) => item.id === box.id);
      if (!before) continue;
      const patch: { isDefault?: boolean; watchesApplications?: boolean } = {};
      if (!before.isDefault && box.isDefault) patch.isDefault = true;
      if (before.watchesApplications !== box.watchesApplications) {
        patch.watchesApplications = box.watchesApplications;
      }
      if (Object.keys(patch).length === 0) continue;
      const result = await patchGmailMailbox(box.id, patch);
      if (!result.ok) return;
    }
    router.refresh();
  };
}
