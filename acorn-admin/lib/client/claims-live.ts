"use client";

import { recordPushDelay, type ClaimPush } from "@acorn/support-chat";
import { useEffect, useSyncExternalStore } from "react";

import { CLAIMS_API } from "../claims";

import { applyClaimChange } from "./claims-cache";
import { isClaimsLive, setClaimsLive, subscribeClaimsLive } from "./claims-link";
import { revalidateCache } from "./query-cache";

/**
 * One live stream of claim changes for the whole console, shared by every component that
 * asks for it. Events land in the client cache directly, lists included, so a new message shows
 * the moment it is sent without asking the server again; polling only runs while the stream is down.
 */

/** The console's route that relays acorn-backend's claim events. */
export const CLAIM_EVENTS_API = `${CLAIMS_API}/events`;

/** Event names on the stream; the same strings as gateway.Support*Event in acorn-backend. */
const CLAIM_EVENT = {
  ready: "ready",
  message: "support:message",
  claim: "support:claim",
} as const;

/** How long to wait before dialing again after the browser gave up on the stream. */
const REOPEN_DELAY_MS = 5_000;

let source: EventSource | null = null;
let reopenTimer: ReturnType<typeof setTimeout> | null = null;
let users = 0;
/** A stream has opened before, so the next "ready" follows a gap that may have missed events. */
let hasOpened = false;

function parse<T>(event: Event): T | null {
  try {
    return JSON.parse((event as globalThis.MessageEvent<string>).data) as T;
  } catch {
    return null;
  }
}

/** Applies one pushed change to the cache and records how late it arrived. */
function apply(event: Event, kind: string) {
  const push = parse<ClaimPush>(event);
  if (!push?.claim?.id) return;
  recordPushDelay(push, kind);
  applyClaimChange(push);
}

function open() {
  const next = new EventSource(CLAIM_EVENTS_API);
  source = next;
  next.addEventListener(CLAIM_EVENT.ready, () => {
    setClaimsLive(true);
    if (hasOpened) revalidateCache((key) => key.startsWith(CLAIMS_API));
    hasOpened = true;
  });
  next.addEventListener(CLAIM_EVENT.message, (event) => apply(event, CLAIM_EVENT.message));
  next.addEventListener(CLAIM_EVENT.claim, (event) => apply(event, CLAIM_EVENT.claim));
  next.onerror = () => {
    setClaimsLive(false);
    // CONNECTING means the browser is already retrying; CLOSED means it stopped for good.
    if (next.readyState !== EventSource.CLOSED || source !== next) return;
    source = null;
    reopenTimer = setTimeout(() => {
      reopenTimer = null;
      if (users > 0 && !source) open();
    }, REOPEN_DELAY_MS);
  };
}

function close() {
  if (reopenTimer) clearTimeout(reopenTimer);
  reopenTimer = null;
  source?.close();
  source = null;
  setClaimsLive(false);
}

/** Keeps the console's claim stream open while mounted; true while events are flowing. */
export function useClaimsLive(): boolean {
  useEffect(() => {
    users += 1;
    if (!source && !reopenTimer) open();
    return () => {
      users -= 1;
      if (users === 0) close();
    };
  }, []);
  return useSyncExternalStore(subscribeClaimsLive, isClaimsLive, () => false);
}
