"use server";

// The console's client cache applies each change itself, so no route is revalidated here.

import { claimPath } from "../api/claims";
import { adminSend } from "../api/client";

import { toResult } from "./result";

import type { ClaimStatus, SupportClaim, SupportMessage } from "@acorn/support-chat";

export async function sendClaimMessageAction(id: string, body: string) {
  return toResult(async () => {
    const res = await adminSend<{ message: SupportMessage }>(`${claimPath(id)}/messages`, "POST", {
      body,
    });
    return res.message;
  });
}

export async function setClaimStatusAction(id: string, status: ClaimStatus) {
  return toResult(async () => {
    const res = await adminSend<{ claim: SupportClaim }>(claimPath(id), "PATCH", { status });
    return res.claim;
  });
}

export async function markClaimReadAction(id: string) {
  return toResult(async () => {
    await adminSend(`${claimPath(id)}/read`, "POST");
  });
}
