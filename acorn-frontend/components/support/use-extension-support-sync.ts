"use client";

import { useEffect, useState } from "react";
import {
  ACORN_EXTENSION_HELLO,
  ACORN_EXTENSION_PING,
  ACORN_SUPPORT_HANDOFF,
  ACORN_SUPPORT_HANDOFF_ACK,
  type AcornExtensionHello,
  type AcornSupportHandoffAck,
} from "@acorn/shared/api";
import { extensionSupportCode } from "@/lib/auth/support-actions";
import { EXTENSION_ACK_TIMEOUT_MS, EXTENSION_HANDOFF_RETRY_MS } from "@/lib/support";

export type ExtensionSync =
  | { kind: "checking" }
  | { kind: "linked" }
  | { kind: "missing" }
  | { kind: "failed"; error: string };

type Incoming = AcornExtensionHello | AcornSupportHandoffAck;

/**
 * Keeps the Acorn extension in this page's support session. Asks the extension
 * whom it is signed in as; when that is not this support session, gets a
 * one-time code (or uses `initialCode`) and hands it over. Each step repeats
 * every EXTENSION_HANDOFF_RETRY_MS, because the extension's content script can
 * load after this page, and gives up after EXTENSION_ACK_TIMEOUT_MS of silence.
 */
export function useExtensionSupportSync({
  accountId,
  initialCode,
  onCodeUsed,
}: {
  accountId: string;
  initialCode?: string;
  onCodeUsed?: () => void;
}): ExtensionSync {
  const [state, setState] = useState<ExtensionSync>({ kind: "checking" });

  useEffect(() => {
    let phase: "ping" | "code" | "handoff" | "done" = "ping";
    let repeat = 0;
    let silence = 0;

    const origin = window.location.origin;
    const keepPosting = (message: object) => {
      window.clearInterval(repeat);
      window.clearTimeout(silence);
      const send = () => window.postMessage(message, origin);
      send();
      repeat = window.setInterval(send, EXTENSION_HANDOFF_RETRY_MS);
      silence = window.setTimeout(() => finish({ kind: "missing" }), EXTENSION_ACK_TIMEOUT_MS);
    };
    const finish = (next: ExtensionSync) => {
      phase = "done";
      window.clearInterval(repeat);
      window.clearTimeout(silence);
      setState(next);
    };

    const handOff = async () => {
      phase = "code";
      window.clearInterval(repeat);
      window.clearTimeout(silence);
      let code = initialCode;
      if (!code) {
        const result = await extensionSupportCode();
        if (phase !== "code") return;
        if (!result.ok) return finish({ kind: "failed", error: result.error });
        code = result.code;
      }
      phase = "handoff";
      keepPosting({ type: ACORN_SUPPORT_HANDOFF, code });
    };

    const onMessage = (event: MessageEvent<Incoming>) => {
      if (event.source !== window || event.origin !== origin) return;
      const data = event.data;
      if (data?.type === ACORN_EXTENSION_HELLO && phase === "ping") {
        if (data.accountId === accountId && data.supportBy) finish({ kind: "linked" });
        else void handOff();
      } else if (data?.type === ACORN_SUPPORT_HANDOFF_ACK && phase === "handoff") {
        onCodeUsed?.();
        finish(data.ok ? { kind: "linked" } : { kind: "failed", error: data.error ?? "" });
      }
    };

    window.addEventListener("message", onMessage);
    keepPosting({ type: ACORN_EXTENSION_PING });
    return () => {
      phase = "done";
      window.removeEventListener("message", onMessage);
      window.clearInterval(repeat);
      window.clearTimeout(silence);
    };
  }, [accountId, initialCode, onCodeUsed]);

  return state;
}
