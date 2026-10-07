"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

import { ClaimConversation } from "./claim-conversation";
import { ClaimDetails } from "./claim-details";

import type { ClaimThreadData } from "@acorn/support-chat";

import { CLAIMS_POLL_MS } from "@/lib/config";
import { ROUTES } from "@/lib/routes";

const LIST_WIDTH = 340;
const DETAILS_WIDTH = 300;
/** Below this the list and the conversation take turns. */
const SPLIT_MIN_WIDTH = CONTAINER_TIERS.lg;
/** Room for the details panel beside the conversation; narrower opens it in a drawer. */
const DOCK_MIN_WIDTH = CONTAINER_TIERS.xl;

/**
 * Support's claims workspace: claims on the left, the open conversation in the
 * middle, the report's screenshot and context on the right. It checks for new
 * messages every CLAIMS_POLL_MS while the page is visible.
 */
export function ClaimsInbox({ list, thread }: { list: ReactNode; thread: ClaimThreadData | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const isMeasured = width > 0;
  const isSplit = !isMeasured || width >= SPLIT_MIN_WIDTH;
  const canDock = isMeasured && width >= DOCK_MIN_WIDTH;
  const [detailsPreferred, setDetailsPreferred] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, CLAIMS_POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  const isDetailsOpen = canDock ? detailsPreferred : drawerOpen;
  const toggleDetails = () => (canDock ? setDetailsPreferred((v) => !v) : setDrawerOpen((v) => !v));
  const back = () => router.push(`${ROUTES.claims}?${params.toString()}`);

  const conversation = thread ? (
    <ClaimConversation
      thread={thread}
      isDetailsOpen={isDetailsOpen}
      onToggleDetails={toggleDetails}
      onBack={isSplit ? undefined : back}
    />
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
          <LayoutContent padding={0}>{isSplit || thread ? conversation : list}</LayoutContent>
        }
        end={
          canDock && detailsPreferred && thread ? (
            <LayoutPanel
              width={DETAILS_WIDTH}
              hasDivider
              isScrollable
              padding={5}
              label="Claim details"
            >
              <ClaimDetails claim={thread.claim} />
            </LayoutPanel>
          ) : undefined
        }
      />
      <Drawer
        isOpen={!canDock && drawerOpen && thread !== null}
        onOpenChange={setDrawerOpen}
        title="Claim details"
        size="sm"
      >
        {thread ? <ClaimDetails claim={thread.claim} /> : null}
      </Drawer>
    </Card>
  );
}
