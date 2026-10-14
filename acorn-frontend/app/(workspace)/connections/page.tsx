import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader, Stack } from "sid-ui";
import { ConnectionsEmail } from "@/components/connections/connections-email";
import { ConnectionsExtension } from "@/components/connections/connections-extension";
import { currentAccount } from "@/lib/auth/session";
import { loadGmailMailboxes } from "@/lib/gmail/api";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Connections" };

export default async function ConnectionsPage() {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  const boxes = await loadGmailMailboxes();
  return (
    <Stack gap={6}>
      <PageHeader
        title="Connections"
        description="The inbox Acorn watches for recruiter replies, and the browser extension that applies for you."
      />
      <ConnectionsEmail mailboxes={boxes.ok ? boxes.data : []} loadError={!boxes.ok} />
      <ConnectionsExtension />
    </Stack>
  );
}
