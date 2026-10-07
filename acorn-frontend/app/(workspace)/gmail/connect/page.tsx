import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GMAIL_ERROR_PARAM, gmailErrorMessage } from "@acorn/google-gmail";
import { Card, PageHeader, Stack } from "sid-ui";
import { GmailConnectForm } from "@/components/workspace/gmail/connect-form";
import { currentAccount } from "@/lib/auth/session";
import { ROUTES, safeNextPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Connect Gmail" };

export default async function GmailConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ [GMAIL_ERROR_PARAM]?: string; next?: string }>;
}) {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  const params = await searchParams;
  const next = safeNextPath(params.next) || ROUTES.gmail;
  return (
    <Stack gap={6}>
      <PageHeader
        title="Connect Gmail"
        description="Sign in with the Google account that owns the inbox you want Acorn to watch."
      />
      <Card padding={6}>
        <GmailConnectForm next={next} error={gmailErrorMessage(params[GMAIL_ERROR_PARAM])} />
      </Card>
    </Stack>
  );
}
