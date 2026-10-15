import {
  CLAIM_AUTHOR,
  CLAIM_STATUS,
  CLAIM_STATUS_LABEL,
  ClaimListItem,
  ClaimStatusBadge,
  ClaimThread,
  claimTitle,
  pageHost,
  type ClaimStatus,
} from "@acorn/support-chat";
import { useState } from "react";
import {
  Banner,
  Button,
  EmptyState,
  Glyph,
  HStack,
  IconButton,
  List,
  SegmentedControl,
  SegmentedControlItem,
  Spinner,
  Stack,
  StackItem,
  Text,
} from "sid-ui";

import { AcornFaceView } from "../acorn-face/AcornFaceView";
import { ACORN_FACE_CARD_PX } from "../acorn-face/constants";

import { pushAcornNotice } from "./acorn-notice";

import type { AcornMainTab } from "./SidebarNav";
import type { useSupportClaims } from "./use-support-claims";

function SupportStaffAvatar() {
  return (
    <span
      className="acorn-support-avatar"
      style={{ width: ACORN_FACE_CARD_PX, height: ACORN_FACE_CARD_PX }}
      aria-hidden
    >
      <AcornFaceView mode="smile" size={ACORN_FACE_CARD_PX} live label="Acorn Support" />
    </span>
  );
}

type SupportState = ReturnType<typeof useSupportClaims>;

/** What each list shows when it has nothing. */
const EMPTY_LIST: Record<ClaimStatus, { title: string; description: string }> = {
  open: {
    title: "No open reports",
    description:
      "Use Report on any page. Support sees a screenshot and your notes, and replies here.",
  },
  closed: {
    title: "Nothing resolved yet",
    description: "Reports support resolves land here. Open one to read it or reopen it.",
  },
};

/**
 * The Support tab: this person's open or resolved reports, newest conversation first.
 * Opening one shows the chat with support; a reply or Reopen brings a resolved one back.
 */
export function SupportPanel({
  mainTab,
  support,
  onReport,
  reportDisabled,
}: {
  mainTab: AcornMainTab;
  support: SupportState;
  onReport: () => void;
  reportDisabled: boolean;
}) {
  const {
    claims,
    thread,
    openId,
    loading,
    error,
    open,
    send,
    reopen,
    attachmentSrc,
    openAttachments,
  } = support;
  const [view, setView] = useState<ClaimStatus>(CLAIM_STATUS.open);
  const [reopening, setReopening] = useState(false);
  const shown = claims.filter((claim) => claim.status === view);
  const countOf = (status: ClaimStatus) => claims.filter((c) => c.status === status).length;

  const reopenOpenThread = async () => {
    setReopening(true);
    try {
      await reopen();
    } catch (err) {
      pushAcornNotice({
        kind: "error",
        title: "Couldn’t reopen the report",
        detail: err instanceof Error ? err.message : "Try again in a moment.",
      });
    } finally {
      setReopening(false);
    }
  };

  return (
    <section
      id="acorn-panel-support"
      className="acorn-panel acorn-panel-support"
      aria-label="Support"
      hidden={mainTab !== "support"}
    >
      {openId ? (
        <Stack gap={3} height="100%">
          <HStack gap={2} vAlign="center">
            <IconButton
              label="Back to reports"
              icon={<Glyph name="arrowLeft" />}
              variant="ghost"
              size="sm"
              onClick={() => void open(null)}
            />
            <StackItem size="fill">
              <Stack gap={0}>
                <Text weight="semibold" maxLines={1}>
                  {thread ? claimTitle(thread.claim) : "Report"}
                </Text>
                {thread ? (
                  <Text type="supporting" maxLines={1}>
                    {pageHost(thread.claim.pageUrl)}
                  </Text>
                ) : null}
              </Stack>
            </StackItem>
            {thread ? <ClaimStatusBadge status={thread.claim.status} /> : null}
            {thread?.claim.status === CLAIM_STATUS.closed ? (
              <Button
                label={reopening ? "Reopening…" : "Reopen"}
                variant="secondary"
                size="sm"
                icon={<Glyph name="refresh" />}
                isDisabled={reopening}
                onClick={() => void reopenOpenThread()}
              />
            ) : null}
          </HStack>
          <div className="acorn-support-thread">
            {thread ? (
              <ClaimThread
                claim={thread.claim}
                messages={thread.messages}
                viewer={CLAIM_AUTHOR.user}
                density="compact"
                placeholder="Message Acorn Support"
                staffAvatar={<SupportStaffAvatar />}
                attachmentSrc={attachmentSrc}
                onOpenAttachments={openAttachments}
                onSend={send}
              />
            ) : (
              <HStack hAlign="center">
                <Spinner size="sm" />
              </HStack>
            )}
          </div>
        </Stack>
      ) : (
        <Stack gap={3}>
          <HStack gap={2} vAlign="center">
            <StackItem size="fill">
              <Text weight="semibold">Your reports</Text>
            </StackItem>
            <Button
              label="Report a problem"
              variant="secondary"
              size="sm"
              icon={<Glyph name="chat" />}
              isDisabled={reportDisabled}
              onClick={onReport}
            />
          </HStack>
          <SegmentedControl
            label="Which reports"
            value={view}
            onChange={(value) => setView(value as ClaimStatus)}
            size="sm"
            layout="fill"
          >
            {[CLAIM_STATUS.open, CLAIM_STATUS.closed].map((status) => (
              <SegmentedControlItem
                key={status}
                value={status}
                label={`${CLAIM_STATUS_LABEL[status]} (${countOf(status)})`}
              />
            ))}
          </SegmentedControl>
          {error ? (
            <Banner status="error" title="Couldn’t load your reports" description={error} />
          ) : null}
          {shown.length === 0 && !loading ? (
            <EmptyState
              isCompact
              icon={<Glyph name={view === CLAIM_STATUS.open ? "chat" : "check"} />}
              title={EMPTY_LIST[view].title}
              description={EMPTY_LIST[view].description}
            />
          ) : (
            <List>
              {shown.map((claim) => (
                <ClaimListItem
                  key={claim.id}
                  claim={claim}
                  showReporter={false}
                  isSelected={false}
                  onOpen={() => void open(claim.id)}
                />
              ))}
            </List>
          )}
        </Stack>
      )}
    </section>
  );
}
