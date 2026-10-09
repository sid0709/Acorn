"use client";

import type { ReactNode } from "react";
import { bindWorkspaceAccount } from "@/lib/workspace/model";

/** Binds this tab's workspace to the signed-in account before the page reads it. */
export function WorkspaceScope({
  accountId,
  support,
  children,
}: {
  accountId: string;
  support: boolean;
  children: ReactNode;
}) {
  bindWorkspaceAccount(accountId, support);
  return children;
}
