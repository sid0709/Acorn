import type { Metadata } from "next";
import { Banner, Button, Card, Center, PageContainer, Stack, Text } from "sid-ui";
import { ExtensionHandoff } from "@/components/support/extension-handoff";
import { currentAccount } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";
import { SUPPORT_PARAM } from "@/lib/support";

export const metadata: Metadata = { title: "Support session" };

/** Where an admin lands after "Sign in as user": the session, the extension handoff, then the app. */
export default async function SupportSessionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const account = await currentAccount();
  const error = params[SUPPORT_PARAM.error];
  const code = params[SUPPORT_PARAM.extensionCode];

  return (
    <PageContainer width="narrow">
      <Center>
        <Card padding={6}>
          <Stack gap={5}>
            {error || !account?.support ? (
              <Banner
                status="error"
                title="Support session not started"
                description={error || "Open a new support link from the admin console."}
              />
            ) : (
              <>
                <Stack gap={1}>
                  <Text as="h1" type="large" weight="semibold">
                    {`Signed in as ${account.name}`}
                  </Text>
                  <Text color="secondary">
                    {`${account.email} · support session opened by ${account.support.by}`}
                  </Text>
                </Stack>
                {code ? <ExtensionHandoff code={code} /> : null}
                <Button label="Continue to Acorn" variant="primary" href={ROUTES.overview} />
              </>
            )}
          </Stack>
        </Card>
      </Center>
    </PageContainer>
  );
}
