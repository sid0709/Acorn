"use server";

// The console's client cache applies each change itself, so no route is revalidated here.
// Replies go through /api/claims/[id]/messages instead: they carry images past an action's limit.

import { claimPath } from "../api/claims";
import { adminSend } from "../api/client";

import { toResult } from "./result";

import type { ClaimStatus, SupportClaim, SupportMessage } from "@acorn/support-chat";

/** Resolves or reopens a claim; `message` is the line the conversation records, when it changed. */
export async function setClaimStatusAction(id: string, status: ClaimStatus) {
  return toResult(async () =>
    adminSend<{ claim: SupportClaim; message?: SupportMessage }>(claimPath(id), "PATCH", {
      status,
    }),
  );
}

export async function markClaimReadAction(id: string) {
  return toResult(async () => {
    await adminSend(`${claimPath(id)}/read`, "POST");
  });
}
