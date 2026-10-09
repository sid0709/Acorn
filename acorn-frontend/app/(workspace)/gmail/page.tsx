import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { GmailInbox } from "@/components/workspace/gmail/gmail-inbox";
import { GmailSkeleton } from "@/components/workspace/gmail/gmail-skeleton";
import { GmailPanel } from "@/components/workspace/gmail-panel";
import { currentAccount } from "@/lib/auth/session";
import { loadGmailMailboxes } from "@/lib/gmail/api";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Gmail" };

/** The inbox's shape shows at once; the mailboxes stream in. */
export default async function GmailPage() {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  return (
    <Suspense fallback={<GmailSkeleton />}>
      <MailboxSection />
    </Suspense>
  );
}

async function MailboxSection() {
  const boxes = await loadGmailMailboxes();
  const mailboxes = boxes.ok ? boxes.data : [];
  if (mailboxes.length === 0) return <GmailPanel mailboxes={[]} />;
  return await GmailInbox({ mailboxes });
}
