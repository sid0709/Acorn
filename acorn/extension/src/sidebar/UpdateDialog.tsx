import {
  Button,
  Dialog,
  DialogHeader,
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  Stack,
  Text,
} from "sid-ui";

import type { AvailableUpdate } from "./latest-release";

/**
 * Says this extension is older than the one Acorn was last deployed with, and
 * links to the new build. Shown once when the sidebar opens.
 */
export function UpdateDialog({
  update,
  onDismiss,
}: {
  update: AvailableUpdate | null;
  onDismiss: () => void;
}) {
  return (
    <Dialog isOpen={update != null} onOpenChange={(open) => !open && onDismiss()} purpose="info">
      <Layout
        height="auto"
        header={
          <DialogHeader
            title="Update Acorn"
            subtitle={update ? `v${update.current} → v${update.latest}` : undefined}
            onOpenChange={(open) => !open && onDismiss()}
            hasDivider
          />
        }
        content={
          <LayoutContent>
            <Stack gap={2}>
              <Text>
                {update
                  ? `This is Acorn v${update.current}. Version ${update.latest} is out, with the latest fixes.`
                  : ""}
              </Text>
              <Text type="supporting">
                Download the new version, unzip it over your Acorn folder, then reload the extension
                in chrome://extensions. Your profile and settings stay with your account.
              </Text>
            </Stack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={2} hAlign="end">
              <Button label="Later" variant="ghost" onClick={onDismiss} />
              <Button
                label="Update"
                variant="primary"
                href={update?.href}
                target="_blank"
                rel="noopener noreferrer"
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
