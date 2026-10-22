import { Badge, Button, Card, Glyph, HStack, Heading, Stack, Text } from "sid-ui";

/** Oak, the second extension: fills each page, picks the résumé from a job-description shot, counts a sent page. */
export function OakExtensionCard({
  downloadUrl,
  version,
}: {
  downloadUrl: string | null;
  version: string | null;
}) {
  return (
    <Card padding={5}>
      <Stack gap={4}>
        <HStack hAlign="between" vAlign="center" gap={2}>
          <HStack gap={2} vAlign="center">
            <Glyph name="download" />
            <Heading level={3}>Oak for Chrome</Heading>
          </HStack>
          <Badge
            label={version ? `v${version}` : "Available"}
            variant={downloadUrl ? "success" : "neutral"}
          />
        </HStack>
        <Text color="secondary">
          Fill the page you are on. Take a shot of the job description and Oak picks the right
          résumé from your Library, fills the form, and counts the page as sent here once you press
          Sent. Verification emails land in its Emails tab. Sign in with your Acorn email and the
          extension password from your profile.
        </Text>
        <Stack gap={2}>
          <Button
            label="Download .zip"
            variant="primary"
            icon={<Glyph name="download" />}
            href={downloadUrl ?? undefined}
            isDisabled={!downloadUrl}
          />
          <Text color="secondary">
            Unzip it, open chrome://extensions, turn on Developer mode, and choose Load unpacked.
          </Text>
        </Stack>
      </Stack>
    </Card>
  );
}
