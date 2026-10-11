"use client";

import { ClaimListItem, type SupportClaim } from "@acorn/support-chat";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Badge,
  EmptyState,
  Glyph,
  HStack,
  Heading,
  Layout,
  LayoutContent,
  LayoutHeader,
  List,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  Stack,
  TextInput,
  icons,
} from "sid-ui";

import { CLAIM_FILTERS, claimThreadKey, type ClaimFilter } from "@/lib/claims";
import { prefetchCache } from "@/lib/client/query-cache";
import { ROUTES } from "@/lib/routes";

const SEARCH_DELAY_MS = 200;
/** Placeholder rows while the first list loads. */
const SKELETON_ROWS = 6;
const SKELETON_ROW_HEIGHT = 72;

/** Moves the address without a server round trip; the workspace reads it and the cache answers. */
function go(url: string, replace = false) {
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

/** The left rail: what waits on support, search, the Opened/Closed switch, then every claim. */
export function ClaimListPanel({
  claims,
  filter,
  query,
  awaitingSupport,
  selectedId,
}: {
  /** Undefined until the first answer. */
  claims: SupportClaim[] | undefined;
  filter: ClaimFilter;
  query: string;
  awaitingSupport: number;
  selectedId: string | null;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(query);

  const withParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    return next.toString();
  };

  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (search.trim()) next.set("q", search.trim());
      else next.delete("q");
      go(`${pathname}?${next.toString()}`, true);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, query, params, pathname]);

  const open = (id: string) => {
    if (id !== selectedId) go(`${ROUTES.claim(id)}?${params.toString()}`);
  };

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <Stack gap={3}>
            <HStack gap={2} vAlign="center">
              <Heading level={1}>Claims</Heading>
              {awaitingSupport > 0 ? (
                <Badge label={`${awaitingSupport} waiting`} variant="info" />
              ) : null}
            </HStack>
            <TextInput
              label="Search claims"
              isLabelHidden
              placeholder="Search people, pages or notes"
              startIcon={icons.search}
              value={search}
              onChange={setSearch}
              hasClear
            />
            <SegmentedControl
              label="Show"
              value={filter}
              onChange={(value) => go(`${pathname}?${withParam("status", value)}`)}
              layout="fill"
              size="sm"
            >
              {CLAIM_FILTERS.map((item) => (
                <SegmentedControlItem key={item.value} value={item.value} label={item.label} />
              ))}
            </SegmentedControl>
          </Stack>
        </LayoutHeader>
      }
      content={
        <LayoutContent isScrollable padding={2} label="Claims">
          {claims === undefined ? (
            <Stack gap={2} aria-busy="true" aria-label="Loading claims">
              {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <Skeleton key={i} height={SKELETON_ROW_HEIGHT} />
              ))}
            </Stack>
          ) : claims.length === 0 ? (
            <EmptyState
              isCompact
              icon={<Glyph name={query ? "search" : "check"} />}
              title={query ? "No matches" : "Nothing here"}
              description={query ? `Nothing matches “${query}”.` : "No claims with this status."}
            />
          ) : (
            <List>
              {claims.map((claim) => (
                <ClaimListItem
                  key={claim.id}
                  claim={claim}
                  showReporter
                  isSelected={claim.id === selectedId}
                  onOpen={() => open(claim.id)}
                  onIntent={() => prefetchCache(claimThreadKey(claim.id))}
                />
              ))}
            </List>
          )}
        </LayoutContent>
      }
    />
  );
}
