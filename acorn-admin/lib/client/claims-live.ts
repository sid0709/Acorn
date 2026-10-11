"use client";

import { useEffect, useSyncExternalStore } from "react";

import { CLAIMS_API, isClaimsListKey } from "../claims";

import { appendCachedMessage, patchCachedClaim } from "./claims-cache";
import { revalidateCache } from "./query-cache";

import type { SupportClaim, SupportMessage } from "@acorn/support-chat";

/**
 * One live stream of claim changes for the whole console, shared by every component that
 * asks for it. Events land in the client cache directly, so a new message shows the moment
 * it is sent; polling only runs while the stream is down.
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

type MessageEvent = { claim: SupportClaim; message: SupportMessage };
type ClaimEvent = { claim: SupportClaim };

let source: EventSource | null = null;
let reopenTimer: ReturnType<typeof setTimeout> | null = null;
let users = 0;
let live = false;
/** A stream has opened before, so the next "ready" follows a gap that may have missed events. */
let hasOpened = false;
const listeners = new Set<() => void>();

function setLive(next: boolean) {
  if (live === next) return;
  live = next;
  listeners.forEach((listener) => listener());
}

function parse<T>(event: Event): T | null {
  try {
    return JSON.parse((event as globalThis.MessageEvent<string>).data) as T;
  } catch {
    return null;
  }
}

/** Every list can change order, counts, or membership on any claim change. */
function revalidateLists() {
  revalidateCache(isClaimsListKey);
}

function open() {
  const next = new EventSource(CLAIM_EVENTS_API);
  source = next;
  next.addEventListener(CLAIM_EVENT.ready, () => {
    setLive(true);
    if (hasOpened) revalidateCache((key) => key.startsWith(CLAIMS_API));
    hasOpened = true;
  });
  next.addEventListener(CLAIM_EVENT.message, (event) => {
    const body = parse<MessageEvent>(event);
    if (!body?.claim?.id) return;
    appendCachedMessage(body.claim.id, body.message);
    patchCachedClaim(body.claim.id, body.claim);
    revalidateLists();
  });
  next.addEventListener(CLAIM_EVENT.claim, (event) => {
    const body = parse<ClaimEvent>(event);
    if (!body?.claim?.id) return;
    patchCachedClaim(body.claim.id, body.claim);
    revalidateLists();
  });
  next.onerror = () => {
    setLive(false);
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
  setLive(false);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
  return useSyncExternalStore(
    subscribe,
    () => live,
    () => false,
  );
}
