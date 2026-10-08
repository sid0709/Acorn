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
import { useRouter } from "next/navigation";
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
  Stack,
  StackItem,
  Text,
} from "sid-ui";

import { useNotice } from "@/components/use-notice";
import {
  markClaimReadAction,
  sendClaimMessageAction,
  setClaimStatusAction,
} from "@/lib/actions/claims";
import { unwrap } from "@/lib/actions/result";

const AVATAR_SIZE = 40;

/** The open claim: who reported what, resolve or reopen, and the conversation with a composer. */
export function ClaimConversation({
  thread,
  isDetailsOpen,
  onToggleDetails,
  onBack,
}: {
  thread: ClaimThreadData;
  isDetailsOpen: boolean;
  onToggleDetails: () => void;
  onBack?: () => void;
}) {
  const router = useRouter();
  const notice = useNotice();
  const { claim, messages } = thread;
  const reporter = claim.userName || claim.userEmail;

  useEffect(() => {
    if (!claim.unread) return;
    void markClaimReadAction(claim.id).then(() => router.refresh());
  }, [claim.id, claim.unread, router]);

  const setStatus = async (status: ClaimStatus) => {
    const result = await setClaimStatusAction(claim.id, status);
    if (!result.ok)
      notice({ kind: "error", title: "Couldn’t change the status", detail: result.error });
    router.refresh();
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
          <ClaimThread
            key={claim.id}
            claim={claim}
            messages={messages}
            viewer={CLAIM_AUTHOR.admin}
            placeholder={`Reply to ${reporter}`}
            onSend={async (body) => {
              unwrap(await sendClaimMessageAction(claim.id, body));
              router.refresh();
            }}
          />
        </LayoutContent>
      }
    />
  );
}
