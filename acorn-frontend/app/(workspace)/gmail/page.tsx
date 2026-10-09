import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GmailInbox } from "@/components/workspace/gmail/gmail-inbox";
import { GmailPanel } from "@/components/workspace/gmail-panel";
import { currentAccount } from "@/lib/auth/session";
import { loadGmailMailboxes } from "@/lib/gmail/api";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Gmail" };

export default async function GmailPage() {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  const boxes = await loadGmailMailboxes();
  const mailboxes = boxes.ok ? boxes.data : [];
  if (mailboxes.length === 0) return <GmailPanel mailboxes={[]} />;
  return await GmailInbox({ mailboxes });
}
