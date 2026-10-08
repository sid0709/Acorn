import { broadcastOperatorNotice, isSocketAuthError, socketErrorDetail } from "../operator-notice";

/** A drop shorter than this heals silently; socket.io usually redials within it. */
const OUTAGE_NOTICE_DELAY_MS = 5_000;
/** One toast slot for connection state: "Reconnected" replaces "Reconnecting". */
const CONNECTION_NOTICE_ID = "acorn-connection";

/**
 * One notice per outage instead of one per failed attempt. A short blip shows
 * nothing. A longer one shows "Reconnecting…" once, and recovery shows "Reconnected"
 * only if the user saw it was down. Retrying is the socket's job; this only reports it.
 */
export function createConnectionNotice() {
  let downTimer: ReturnType<typeof setTimeout> | null = null;
  let announced = false;
  let lastError: Error | null = null;

  const clearTimer = () => {
    if (downTimer) clearTimeout(downTimer);
    downTimer = null;
  };

  const announce = () => {
    downTimer = null;
    announced = true;
    if (lastError && isSocketAuthError(lastError.message)) {
      broadcastOperatorNotice({
        id: CONNECTION_NOTICE_ID,
        kind: "error",
        title: "Session expired",
        detail: socketErrorDetail(lastError.message),
      });
      return;
    }
    broadcastOperatorNotice({
      id: CONNECTION_NOTICE_ID,
      kind: "info",
      title: "Reconnecting…",
      detail: navigator.onLine
        ? "Can’t reach Acorn right now. Retrying automatically."
        : "You’re offline. Acorn will reconnect when the network is back.",
    });
  };

  return {
    markDown(err: Error | null) {
      if (err) lastError = err;
      if (announced || downTimer) return;
      downTimer = setTimeout(announce, OUTAGE_NOTICE_DELAY_MS);
    },
    markConnected() {
      clearTimer();
      lastError = null;
      if (!announced) return;
      announced = false;
      broadcastOperatorNotice({
        id: CONNECTION_NOTICE_ID,
        kind: "success",
        title: "Reconnected",
        detail: "Connected to Acorn.",
      });
    },
    /** Not trying to connect (signed out): nothing to report either way. */
    reset() {
      clearTimer();
      announced = false;
      lastError = null;
    },
  };
}
