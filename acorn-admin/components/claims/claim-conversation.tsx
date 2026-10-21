"use client";

import {
  CLAIM_AUTHOR,
  CLAIM_STATUS,
  ClaimStatusBadge,
  ClaimThread,
  claimTitle,
  type ClaimStatus,
  type ClaimThreadData,
} from "@acorn/support-chat";
import { useEffect } from "react";
import {
  Avatar,
  Button,
  HStack,
  Heading,
  IconButton,
  Glyph,
  Layout,
  LayoutContent,
  LayoutHeader,
  Skeleton,
  Stack,
  StackItem,
  Text,
} from "sid-ui";

import { useNotice } from "@/components/use-notice";
import { markClaimReadAction, setClaimStatusAction } from "@/lib/actions/claims";
import { sendClaimMessage } from "@/lib/client/claim-messages";
import { appendCachedMessage, patchCachedClaim, revalidateClaim } from "@/lib/client/claims-cache";
import { ROUTES } from "@/lib/routes";

const AVATAR_SIZE = 40;
/** Placeholder bubbles while a conversation loads: their widths, alternating sides. */
const SKELETON_BUBBLES = ["60%", "45%", "70%"] as const;
const SKELETON_BUBBLE_HEIGHT = 44;

/** Where messages will be, while the conversation loads. */
export function ConversationSkeleton() {
  return (
    <Stack gap={4} padding={6} aria-busy="true" aria-label="Loading the conversation">
      {SKELETON_BUBBLES.map((width, i) => (
        <HStack key={width} hAlign={i % 2 ? "end" : "start"}>
          <Skeleton width={width} height={SKELETON_BUBBLE_HEIGHT} />
        </HStack>
      ))}
    </Stack>
  );
}

/** The open claim: who reported what, resolve or reopen, and the conversation with a composer. */
export function ClaimConversation({
  thread,
  isLoading = false,
  isDetailsOpen,
  onToggleDetails,
  onBack,
}: {
  thread: ClaimThreadData;
  /** The header is real but the messages are still on their way. */
  isLoading?: boolean;
  isDetailsOpen: boolean;
  onToggleDetails: () => void;
  onBack?: () => void;
}) {
  const notice = useNotice();
  const { claim, messages } = thread;
  const reporter = claim.userName || claim.userEmail;

  useEffect(() => {
    if (!claim.unread) return;
    patchCachedClaim(claim.id, { unread: false });
    void markClaimReadAction(claim.id);
  }, [claim.id, claim.unread]);

  const setStatus = async (status: ClaimStatus) => {
    const previous = claim.status;
    patchCachedClaim(claim.id, { status });
    const result = await setClaimStatusAction(claim.id, status);
    if (result.ok) {
      patchCachedClaim(claim.id, result.value.claim);
      if (result.value.message) appendCachedMessage(claim.id, result.value.message);
    } else {
      patchCachedClaim(claim.id, { status: previous });
      notice({ kind: "error", title: "Couldn’t change the status", detail: result.error });
    }
    revalidateClaim(claim.id);
  };

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <HStack gap={3} vAlign="center">
            {onBack ? (
              <IconButton
                label="Back to claims"
                icon={<Glyph name="arrowLeft" />}
                variant="ghost"
                size="sm"
                onClick={onBack}
              />
            ) : null}
            <Avatar name={reporter} size={AVATAR_SIZE} tooltip={false} />
            <StackItem size="fill">
              <Stack gap={0.5}>
                <Heading level={2} maxLines={1}>
                  {claimTitle(claim)}
                </Heading>
                <Text type="supporting" color="secondary" maxLines={1}>
                  {`${reporter} · ${claim.userEmail}`}
                </Text>
              </Stack>
            </StackItem>
            <ClaimStatusBadge status={claim.status} />
            <Button
              label={claim.status === CLAIM_STATUS.open ? "Resolve" : "Reopen"}
              variant={claim.status === CLAIM_STATUS.open ? "primary" : "secondary"}
              size="sm"
              onClick={() =>
                void setStatus(
                  claim.status === CLAIM_STATUS.open ? CLAIM_STATUS.closed : CLAIM_STATUS.open,
                )
              }
            />
            <IconButton
              label={isDetailsOpen ? "Hide details" : "Show details"}
              tooltip={isDetailsOpen ? "Hide details" : "Show details"}
              icon={<Glyph name="panelRight" />}
              variant={isDetailsOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={onToggleDetails}
            />
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={0} isScrollable={false}>
          {isLoading ? (
            <ConversationSkeleton />
          ) : (
            <ClaimThread
              key={claim.id}
              claim={claim}
              messages={messages}
              viewer={CLAIM_AUTHOR.admin}
              placeholder={`Reply to ${reporter}`}
              attachmentSrc={(attachment) => ROUTES.claimAttachment(claim.id, attachment.id)}
              onSend={async (draft) => {
                appendCachedMessage(claim.id, await sendClaimMessage(claim.id, draft));
                revalidateClaim(claim.id);
              }}
            />
          )}
        </LayoutContent>
      }
    />
  );
}
