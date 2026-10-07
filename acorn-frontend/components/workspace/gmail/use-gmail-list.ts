"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchPage, listKey, seedPage } from "@/lib/gmail/client";
import type { GmailListQuery, GmailPage } from "@/lib/gmail/types";

/** A list without its cursor: changing any of these starts again at page one. */
export type GmailListBase = Omit<GmailListQuery, "pageToken">;

type Paging = { baseKey: string; tokens: string[]; index: number };
type Loaded = { key: string; baseKey: string; page: GmailPage | null; error: string };

const FIRST_PAGE = { tokens: [""], index: 0 };

function baseKeyOf(base: GmailListBase) {
  return [base.mailboxId, base.labelId, base.q, base.pageSize].join("\u0000");
}

/**
 * One Gmail listing, paged by Gmail's cursors. The next page loads in the background
 * as soon as this one arrives, so "Next" is usually instant.
 */
export function useGmailList(
  base: GmailListBase,
  initial?: { query: GmailListQuery; page: GmailPage },
) {
  const baseKey = baseKeyOf(base);
  const [paging, setPaging] = useState<Paging>({ baseKey, ...FIRST_PAGE });
  const current = paging.baseKey === baseKey ? paging : { baseKey, ...FIRST_PAGE };
  const pageToken = current.tokens[current.index] ?? "";
  const { mailboxId, labelId, q, pageSize } = base;
  const query = useMemo<GmailListQuery>(
    () => ({ mailboxId, labelId, q, pageSize, pageToken }),
    [mailboxId, labelId, q, pageSize, pageToken],
  );
  const key = listKey(query);

  const [loaded, setLoaded] = useState<Loaded>(() => {
    if (!initial) return { key: "", baseKey: "", page: null, error: "" };
    seedPage(initial.query, initial.page);
    return {
      key: listKey(initial.query),
      baseKey: baseKeyOf(initial.query),
      page: initial.page,
      error: "",
    };
  });

  useEffect(() => {
    let live = true;
    void fetchPage(query).then((result) => {
      if (!live) return;
      setLoaded({
        key: listKey(query),
        baseKey: baseKeyOf(query),
        page: result.ok ? result.data : null,
        error: result.ok ? "" : result.message,
      });
    });
    return () => {
      live = false;
    };
  }, [query]);

  const isCurrent = loaded.key === key;
  const nextToken = isCurrent ? (loaded.page?.nextPageToken ?? "") : "";

  useEffect(() => {
    if (nextToken) void fetchPage({ ...query, pageToken: nextToken });
  }, [query, nextToken]);

  const goTo = useCallback(
    (pageNumber: number) => {
      const index = pageNumber - 1;
      if (index === current.index + 1 && nextToken) {
        setPaging({ baseKey, tokens: [...current.tokens.slice(0, index), nextToken], index });
      } else if (index >= 0 && index < current.index) {
        setPaging({ baseKey, tokens: current.tokens, index });
      }
    },
    [baseKey, current.index, current.tokens, nextToken],
  );

  const refresh = useCallback(async () => {
    const result = await fetchPage(query, true);
    setLoaded({
      key: listKey(query),
      baseKey: baseKeyOf(query),
      page: result.ok ? result.data : null,
      error: result.ok ? "" : result.message,
    });
  }, [query]);

  /** Rows to show: this page, or the previous page of the same list while the next loads. */
  const sameList = loaded.baseKey === baseKey;
  return {
    page: sameList ? loaded.page : null,
    error: isCurrent ? loaded.error : "",
    isLoading: !isCurrent,
    pageNumber: current.index + 1,
    hasMore: Boolean(nextToken),
    goTo,
    refresh,
  };
}
