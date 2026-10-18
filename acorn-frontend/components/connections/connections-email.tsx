"use client";

import { useRouter } from "next/navigation";
import { Banner, Button, EmptyState, Glyph, SectionCard, Stack } from "sid-ui";
import { ROUTES } from "@/lib/routes";
import type { Mailbox } from "@/lib/workspace/model";
import { ConnectedEmail } from "./connected-email";

/** The email connection: connect a Gmail inbox, or manage the ones connected. */
export function ConnectionsEmail({
  mailboxes,
  loadError,
}: {
  mailboxes: Mailbox[];
  loadError: boolean;
}) {
  const router = useRouter();
  const connect = () => router.push(ROUTES.connectGmail);

  if (mailboxes.length > 0) return <ConnectedEmail mailboxes={mailboxes} />;
  return (
    <SectionCard title="Email" description="Gmail replies from recruiters, sorted for you.">
      <Stack gap={4}>
        {loadError ? (
          <Banner
            status="warning"
            title="Couldn’t load your mailboxes"
            description="Refresh the page to try again."
          />
        ) : null}
        <EmptyState
          icon={<Glyph name="mail" />}
          title="No inbox connected"
          description="Connect the Gmail inbox you use for applications. Acorn does not use your Acorn sign-in email automatically."
          actions={
            <Button
              label="Connect Gmail"
              variant="primary"
              icon={<Glyph name="plus" />}
              onClick={connect}
            />
          }
        />
      </Stack>
    </SectionCard>
  );
}
