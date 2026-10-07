"use server";

import { revalidatePath } from "next/cache";

import { claimPath } from "../api/claims";
import { adminSend } from "../api/client";
import { ROUTES } from "../routes";

import { toResult } from "./result";

import type { ClaimStatus, SupportClaim, SupportMessage } from "@acorn/support-chat";

export async function sendClaimMessageAction(id: string, body: string) {
  return toResult(async () => {
    const res = await adminSend<{ message: SupportMessage }>(`${claimPath(id)}/messages`, "POST", {
      body,
    });
    revalidatePath(ROUTES.claims, "layout");
    return res.message;
  });
}

export async function setClaimStatusAction(id: string, status: ClaimStatus) {
  return toResult(async () => {
    const res = await adminSend<{ claim: SupportClaim }>(claimPath(id), "PATCH", { status });
    revalidatePath(ROUTES.claims, "layout");
    return res.claim;
  });
}

export async function markClaimReadAction(id: string) {
  return toResult(async () => {
    await adminSend(`${claimPath(id)}/read`, "POST");
  });
}
