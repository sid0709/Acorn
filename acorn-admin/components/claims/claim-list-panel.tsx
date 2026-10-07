"use client";

import { ClaimListItem, type SupportClaim } from "@acorn/support-chat";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  Stack,
  TextInput,
  icons,
} from "sid-ui";

import { CLAIM_FILTERS, type ClaimFilter } from "@/lib/claims";
import { ROUTES } from "@/lib/routes";

const SEARCH_DELAY_MS = 300;

/** The left rail: what waits on support, search, the Opened/Closed switch, then every claim. */
export function ClaimListPanel({
  claims,
  filter,
  query,
  awaitingSupport,
  selectedId,
}: {
  claims: SupportClaim[];
  filter: ClaimFilter;
  query: string;
  awaitingSupport: number;
  selectedId: string | null;
}) {
  const router = useRouter();
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
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, query, params, pathname, router]);

  const open = (id: string) =>
    router.push(`${ROUTES.claim(id)}?${params.toString()}`, { scroll: false });

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
              onChange={(value) => router.push(`${ROUTES.claims}?${withParam("status", value)}`)}
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
          {claims.length === 0 ? (
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
                />
              ))}
            </List>
          )}
        </LayoutContent>
      }
    />
  );
}
