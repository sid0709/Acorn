"use client";

import {
  Avatar,
  Badge,
  Button,
  Divider,
  Drawer,
  Glyph,
  HStack,
  Heading,
  Stack,
  Switch,
  Text,
} from "sid-ui";
import { formatWhen, type Mailbox } from "@/lib/workspace/model";

/** Set the default mailbox, choose which mailboxes count replies, and disconnect. */
export function MailboxManager({
  isOpen,
  onOpenChange,
  mailboxes,
  onConnect,
  onChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  mailboxes: Mailbox[];
  onConnect: () => void;
  onChange: (mailboxes: Mailbox[]) => void;
}) {
  const patch = (id: string, change: Partial<Mailbox>) => {
    onChange(
      mailboxes.map((mailbox) => {
        if (change.isDefault) return { ...mailbox, isDefault: mailbox.id === id };
        return mailbox.id === id ? { ...mailbox, ...change } : mailbox;
      }),
    );
  };

  const disconnect = (id: string) => {
    const remaining = mailboxes.filter((mailbox) => mailbox.id !== id);
    if (remaining.length > 0 && !remaining.some((mailbox) => mailbox.isDefault)) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }
    onChange(remaining);
  };

  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Mailboxes"
      subtitle="Gmail inboxes Acorn can read"
      size="md"
    >
      <Stack gap={6}>
        <Stack gap={4}>
          <Heading level={3}>Connect another Gmail</Heading>
          <Text color="secondary">
            Each connection uses Google sign-in for that inbox. It is not tied to your Acorn account
            email.
          </Text>
          <HStack>
            <Button
              label="Connect Gmail"
              variant="primary"
              icon={<Glyph name="plus" />}
              onClick={onConnect}
            />
          </HStack>
        </Stack>
        <Divider />
        <Stack gap={5}>
          <Heading level={3}>{`Connected · ${mailboxes.length}`}</Heading>
          {mailboxes.length === 0 ? <Text color="secondary">No Gmail connected yet.</Text> : null}
          {mailboxes.map((mailbox, index) => (
            <Stack key={mailbox.id} gap={4}>
              {index > 0 ? <Divider /> : null}
              <HStack hAlign="between" vAlign="center" wrap="wrap" gap={3}>
                <HStack gap={3} vAlign="center">
                  <Avatar
                    name={mailbox.name || mailbox.email}
                    src={mailbox.picture || undefined}
                    size={36}
                  />
                  <Stack gap={0}>
                    <Text weight="semibold">{mailbox.name || mailbox.email}</Text>
                    <Text type="supporting" color="secondary">
                      {mailbox.name ? `${mailbox.email} · ` : ""}
                      {mailbox.label}
                      {formatWhen(mailbox.connectedAt)
                        ? ` · since ${formatWhen(mailbox.connectedAt)}`
                        : ""}
                    </Text>
                  </Stack>
                </HStack>
                <HStack gap={2} wrap="wrap">
                  {mailbox.isDefault ? <Badge label="Default" variant="blue" /> : null}
                  {mailbox.watchesApplications ? (
                    <Badge label="Watching" variant="success" />
                  ) : null}
                </HStack>
              </HStack>
              <Switch
                label="Default mailbox"
                description="New applications use this address."
                value={mailbox.isDefault}
                onChange={(checked) => {
                  if (checked) patch(mailbox.id, { isDefault: true });
                }}
              />
              <Switch
                label="Watch for replies"
                description="Count recruiter replies toward your statistics."
                value={mailbox.watchesApplications}
                onChange={(checked) => patch(mailbox.id, { watchesApplications: checked })}
              />
              <HStack>
                <Button
                  label="Disconnect"
                  variant="secondary"
                  size="sm"
                  icon={<Glyph name="trash" />}
                  onClick={() => disconnect(mailbox.id)}
                />
              </HStack>
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Drawer>
  );
}
