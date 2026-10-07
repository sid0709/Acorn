import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GmailPanel } from "@/components/workspace/gmail-panel";
import { currentAccount } from "@/lib/auth/session";
import { loadGmailMailboxes, loadGmailMessages } from "@/lib/gmail/api";
import { ROUTES } from "@/lib/routes";
import { loadActivity } from "@/lib/workspace/activity";
import type { MailMessage } from "@/lib/workspace/mail";

export const metadata: Metadata = { title: "Gmail" };

export default async function GmailPage() {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  const { today } = loadActivity();
  const boxes = await loadGmailMailboxes();
  const connectedMailboxes = boxes.ok ? boxes.data : [];
  let mail: MailMessage[] = [];
  if (connectedMailboxes.length > 0) {
    const primary =
      connectedMailboxes.find((mailbox) => mailbox.isDefault) ?? connectedMailboxes[0];
    const messages = await loadGmailMessages(primary.id);
    if (messages.ok) mail = messages.data;
  }
  return (
    <GmailPanel
      account={account}
      mail={mail}
      today={today}
      connectedMailboxes={connectedMailboxes}
    />
  );
}
