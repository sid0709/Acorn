import { Avatar, Badge, Glyph, HStack, ListItem, Stack, StackItem, Text } from "sid-ui";

import { ClaimStatusBadge } from "./ClaimStatusBadge";
import { claimTitle, listTimeLabel, pageHost } from "./format";

import type { SupportClaim } from "./types";

const AVATAR_SIZE = 32;

/**
 * One claim in a list: the page, who reported it (for support) or the page's host
 * (for the reporter), when it last moved, its status, and whether there is news.
 */
export function ClaimListItem({
  claim,
  showReporter,
  isSelected,
  onOpen,
}: {
  claim: SupportClaim;
  /** Support sees the reporter; the reporter sees the page instead. */
  showReporter: boolean;
  isSelected: boolean;
  onOpen: () => void;
}) {
  const subtitle = showReporter ? claim.userName || claim.userEmail : pageHost(claim.pageUrl);
  return (
    <ListItem
      isSelected={isSelected}
      onClick={onOpen}
      aria-current={isSelected ? "true" : undefined}
      startContent={
        showReporter ? (
          <Avatar name={claim.userName || claim.userEmail} size={AVATAR_SIZE} tooltip={false} />
        ) : (
          <Glyph name="chat" />
        )
      }
      label={
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <Text weight={claim.unread ? "semibold" : "medium"} maxLines={1}>
              {claimTitle(claim)}
            </Text>
          </StackItem>
          <Text type="supporting" color="secondary">
            {listTimeLabel(claim.lastMessageAt)}
          </Text>
        </HStack>
      }
      description={
        <Stack gap={1}>
          <Text type="supporting" color="secondary" maxLines={1}>
            {subtitle}
          </Text>
          <HStack gap={1} vAlign="center">
            <ClaimStatusBadge status={claim.status} />
            {claim.unread ? <Badge label="New reply" variant="blue" /> : null}
          </HStack>
        </Stack>
      }
    />
  );
}
