import {
  Banner,
  Button,
  EmptyState,
  Glyph,
  HStack,
  IconButton,
  List,
  Spinner,
  Stack,
  StackItem,
  Text,
} from "sid-ui";
import {
  CLAIM_AUTHOR,
  ClaimListItem,
  ClaimStatusBadge,
  ClaimThread,
  claimTitle,
  pageHost,
} from "@acorn/support-chat";

import type { AcornMainTab } from "./SidebarNav";
import type { useSupportClaims } from "./use-support-claims";

type SupportState = ReturnType<typeof useSupportClaims>;

/**
 * The Support tab: every report this person filed, newest conversation first.
 * Opening one shows the chat with support; a reply reopens a closed report.
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
  const { claims, thread, openId, loading, error, open, send } = support;
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
          </HStack>
          <div className="acorn-support-thread">
            {thread ? (
              <ClaimThread
                claim={thread.claim}
                messages={thread.messages}
                viewer={CLAIM_AUTHOR.user}
                density="compact"
                placeholder="Message Acorn Support"
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
          {error ? (
            <Banner status="error" title="Couldn’t load your reports" description={error} />
          ) : null}
          {claims.length === 0 && !loading ? (
            <EmptyState
              isCompact
              icon={<Glyph name="chat" />}
              title="No reports yet"
              description="Use Report on any page. Support sees a screenshot and your notes, and replies here."
            />
          ) : (
            <List>
              {claims.map((claim) => (
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
