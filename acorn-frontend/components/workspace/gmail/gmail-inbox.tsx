import { loadGmailOverview, loadGmailPage } from "@/lib/gmail/backend";
import type { GmailListQuery } from "@/lib/gmail/types";
import { GMAIL_DEFAULT_PAGE_SIZE, INBOX } from "@/lib/gmail/views";
import type { Mailbox } from "@/lib/workspace/model";

import { GmailPanel } from "../gmail-panel";

/**
 * Reads the default mailbox's labels and first inbox page together on the server,
 * so the inbox arrives with the page instead of after it.
 */
export async function GmailInbox({ mailboxes }: { mailboxes: Mailbox[] }) {
  const primary = mailboxes.find((mailbox) => mailbox.isDefault) ?? mailboxes[0];
  const query: GmailListQuery = {
    mailboxId: primary.id,
    labelId: INBOX,
    q: "",
    pageToken: "",
    pageSize: GMAIL_DEFAULT_PAGE_SIZE,
  };
  const [overview, page] = await Promise.all([loadGmailOverview(primary.id), loadGmailPage(query)]);
  return (
    <GmailPanel
      mailboxes={mailboxes}
      initial={{
        mailboxId: primary.id,
        overview: overview.ok ? overview.data : null,
        query,
        page: page.ok ? page.data : null,
      }}
    />
  );
}
