"use client";

import { useSearchParams } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import {
  CONTAINER_TIERS,
  Card,
  Drawer,
  EmptyState,
  Glyph,
  Layout,
  LayoutContent,
  LayoutPanel,
  useElementWidth,
} from "sid-ui";

import { ClaimConversation, ConversationSkeleton } from "./claim-conversation";
import { ClaimDetails } from "./claim-details";

import type { ClaimThreadData, SupportClaim } from "@acorn/support-chat";

import { ROUTES } from "@/lib/routes";

const LIST_WIDTH = 340;
const DETAILS_WIDTH = 300;
/** Below this the list and the conversation take turns. */
const SPLIT_MIN_WIDTH = CONTAINER_TIERS.lg;
/** Room for the details panel beside the conversation; narrower opens it in a drawer. */
const DOCK_MIN_WIDTH = CONTAINER_TIERS.xl;

/**
 * Support's claims workspace: claims on the left, the open conversation in the
 * middle, the report's screenshot and context on the right. While a conversation loads,
 * its header shows at once from the list row.
 */
export function ClaimsInbox({
  list,
  selectedId,
  thread,
  isThreadLoading,
  threadError,
  summary,
}: {
  list: ReactNode;
  selectedId: string | null;
  thread: ClaimThreadData | null;
  isThreadLoading: boolean;
  threadError?: string;
  /** The open claim's row from the list, shown while its thread loads. */
  summary?: SupportClaim;
}) {
  const params = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const isMeasured = width > 0;
  const isSplit = !isMeasured || width >= SPLIT_MIN_WIDTH;
  const canDock = isMeasured && width >= DOCK_MIN_WIDTH;
  const [detailsPreferred, setDetailsPreferred] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isDetailsOpen = canDock ? detailsPreferred : drawerOpen;
  const toggleDetails = () => (canDock ? setDetailsPreferred((v) => !v) : setDrawerOpen((v) => !v));
  const back = () => window.history.pushState(null, "", `${ROUTES.claims}?${params.toString()}`);
  const shown = thread ?? (summary ? { claim: summary, messages: [] } : null);

  const conversation = shown ? (
    <ClaimConversation
      thread={shown}
      isLoading={!thread}
      isDetailsOpen={isDetailsOpen}
      onToggleDetails={toggleDetails}
      onBack={isSplit ? undefined : back}
    />
  ) : threadError ? (
    <EmptyState
      icon={<Glyph name="search" />}
      title="Couldn’t open this claim"
      description={threadError}
    />
  ) : isThreadLoading ? (
    <ConversationSkeleton />
  ) : (
    <EmptyState
      icon={<Glyph name="chat" />}
      title="Pick a claim"
      description="Choose a report on the left to see the page and talk to the reporter."
    />
  );

  return (
    <Card ref={ref} padding={0} elevation="low" height="100%">
      <Layout
        height="fill"
        start={
          isSplit ? (
            <LayoutPanel width={LIST_WIDTH} hasDivider padding={0} label="Claims">
              {list}
            </LayoutPanel>
          ) : undefined
        }
        content={
          <LayoutContent padding={0}>{isSplit || selectedId ? conversation : list}</LayoutContent>
        }
        end={
          canDock && detailsPreferred && shown ? (
            <LayoutPanel
              width={DETAILS_WIDTH}
              hasDivider
              isScrollable
              padding={5}
              label="Claim details"
            >
              <ClaimDetails claim={shown.claim} />
            </LayoutPanel>
          ) : undefined
        }
      />
      <Drawer
        isOpen={!canDock && drawerOpen && shown !== null}
        onOpenChange={setDrawerOpen}
        title="Claim details"
        size="sm"
      >
        {shown ? <ClaimDetails claim={shown.claim} /> : null}
      </Drawer>
    </Card>
  );
}
