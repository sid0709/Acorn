"use server";

import { revalidatePath } from "next/cache";

import { patchClaimStatus } from "@/lib/api/admin-data";

export async function updateClaimStatusAction(id: string, status: string): Promise<void> {
  await patchClaimStatus(id, status);
  revalidatePath("/claims");
  revalidatePath(`/claims/${id}`);
}
