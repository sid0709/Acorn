"use server";

import { revalidatePath } from "next/cache";

import { adminSend } from "../api/client";
import { supportSessionPath, supportSessionsPath } from "../api/users";
import { ROUTES } from "../routes";

import { toResult } from "./result";

/** A one-time link that opens the client site signed in as the user. */
export async function startSupportSessionAction(userId: string, reason: string) {
  return toResult(async () => {
    const res = await adminSend<{ url: string }>(supportSessionPath(userId), "POST", { reason });
    revalidatePath(ROUTES.user(userId));
    return res.url;
  });
}

/** Signs every support session for the user out, on the site and in the extension. */
export async function endSupportSessionsAction(userId: string) {
  return toResult(async () => {
    const res = await adminSend<{ ended: number }>(supportSessionsPath(userId), "DELETE");
    revalidatePath(ROUTES.user(userId));
    return res.ended;
  });
}
