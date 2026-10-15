import { CLAIM_STATUS, type SupportClaim } from "@acorn/support-chat";
import { describe, expect, test } from "bun:test";

import { claimsListKey, parseClaimsListKey } from "../claims";

import { placeClaim } from "./claims-cache";

import type { ClaimList } from "../api/claims";

function claim(id: string, at: string, over: Partial<SupportClaim> = {}): SupportClaim {
  return {
    id,
    accountId: "a",
    userEmail: "u@example.com",
    userName: "U",
    pageUrl: "https://example.com",
    pageTitle: "",
    notes: "",
    extensionVersion: "",
    tabKey: "",
    status: CLAIM_STATUS.open,
    screenshotMime: "",
    screenshotWidth: 0,
    screenshotHeight: 0,
    messageCount: 1,
    lastMessageAt: at,
    lastMessageBy: "user",
    unread: true,
    createdAt: at,
    ...over,
  };
}

const list = (...claims: SupportClaim[]): ClaimList => ({ claims, open: 9, awaitingSupport: 5 });
const OPEN = claimsListKey("open", "");
const ALL = claimsListKey("all", "");
const CLOSED = claimsListKey("closed", "");
const SEARCH = claimsListKey("all", "billing");
const noCounts = {};

describe("parseClaimsListKey", () => {
  test("reads the filter and the search back out of a key", () => {
    expect(parseClaimsListKey(OPEN)).toEqual({ filter: "open", query: "" });
    expect(parseClaimsListKey(CLOSED)).toEqual({ filter: "closed", query: "" });
    expect(parseClaimsListKey(ALL)).toEqual({ filter: "all", query: "" });
    expect(parseClaimsListKey(SEARCH)).toEqual({ filter: "all", query: "billing" });
  });
});

describe("placeClaim", () => {
  const older = claim("old", "2026-01-01T10:00:00Z");
  const newer = claim("new", "2026-01-02T10:00:00Z");

  test("a message moves its claim to the top and updates its row", () => {
    const changed = claim("old", "2026-01-03T10:00:00Z", { messageCount: 4 });
    const result = placeClaim(list(newer, older), OPEN, changed, noCounts);
    expect(result.claims.map((row) => row.id)).toEqual(["old", "new"]);
    expect(result.claims[0].messageCount).toBe(4);
  });

  test("a new claim joins the lists that show its status", () => {
    const fresh = claim("fresh", "2026-01-04T10:00:00Z");
    expect(placeClaim(list(newer), OPEN, fresh, noCounts).claims.map((c) => c.id)).toEqual([
      "fresh",
      "new",
    ]);
    expect(placeClaim(list(newer), ALL, fresh, noCounts).claims).toHaveLength(2);
    expect(placeClaim(list(), CLOSED, fresh, noCounts).claims).toHaveLength(0);
  });

  test("a resolved claim leaves the open list and joins the resolved one", () => {
    const resolved = claim("old", "2026-01-05T10:00:00Z", { status: CLAIM_STATUS.closed });
    expect(
      placeClaim(list(newer, older), OPEN, resolved, noCounts).claims.map((c) => c.id),
    ).toEqual(["new"]);
    expect(placeClaim(list(), CLOSED, resolved, noCounts).claims.map((c) => c.id)).toEqual(["old"]);
  });

  test("a search list keeps a claim it shows but takes no new ones", () => {
    const fresh = claim("fresh", "2026-01-04T10:00:00Z");
    expect(placeClaim(list(older), SEARCH, fresh, noCounts).claims.map((c) => c.id)).toEqual([
      "old",
    ]);
    const changed = claim("old", "2026-01-06T10:00:00Z", { messageCount: 7 });
    const result = placeClaim(list(older), SEARCH, changed, noCounts);
    expect(result.claims.map((c) => [c.id, c.messageCount])).toEqual([["old", 7]]);
  });

  test("the server's counts replace the list's, and without them the list's stay", () => {
    const changed = claim("old", "2026-01-03T10:00:00Z");
    const counted = placeClaim(list(older), OPEN, changed, { open: 3, awaitingSupport: 0 });
    expect([counted.open, counted.awaitingSupport]).toEqual([3, 0]);
    const kept = placeClaim(list(older), OPEN, changed, noCounts);
    expect([kept.open, kept.awaitingSupport]).toEqual([9, 5]);
  });
});
