import { Avatar, Badge, Button, Glyph, HStack, Heading, Stack, StackItem, Text } from "sid-ui";

import { DeactivatedBadge } from "./deactivated-badge";
import { SupportActions } from "./support-actions";

import type { UserDetail } from "@/lib/api/users";

import { formatDate } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

const AVATAR_SIZE = 64;

/** Who the user is, a way back, and the support actions. */
export function UserHeader({ user }: { user: UserDetail["user"] }) {
  const name = user.name || user.email;
  return (
    <Stack gap={4}>
      <HStack>
        <Button
          label="Users"
          variant="ghost"
          size="sm"
          icon={<Glyph name="arrowLeft" />}
          href={ROUTES.users}
        />
      </HStack>
      <HStack gap={4} vAlign="center" wrap="wrap">
        <Avatar name={name} size={AVATAR_SIZE} tooltip={false} />
        <StackItem size="fill">
          <Stack gap={1}>
            <Heading level={1}>{name}</Heading>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text color="secondary">{user.email}</Text>
              <Badge label={`Joined ${formatDate(user.createdAt)}`} variant="neutral" />
              {user.deactivatedAt ? <DeactivatedBadge at={user.deactivatedAt} /> : null}
            </HStack>
          </Stack>
        </StackItem>
        <SupportActions
          userId={user.id}
          userName={name}
          deactivated={Boolean(user.deactivatedAt)}
        />
      </HStack>
    </Stack>
  );
}
