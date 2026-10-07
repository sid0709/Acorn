"use client";

import { useEffect, useState } from "react";
import { Banner, Spinner, HStack, Text } from "sid-ui";
import {
  ACORN_SUPPORT_HANDOFF,
  ACORN_SUPPORT_HANDOFF_ACK,
  type AcornSupportHandoffAck,
  type AcornSupportHandoffMessage,
} from "@acorn/shared/api";
import { EXTENSION_ACK_TIMEOUT_MS, SUPPORT_PARAM } from "@/lib/support";

type State =
  | { kind: "waiting" }
  | { kind: "linked" }
  | { kind: "missing" }
  | { kind: "failed"; error: string };

/**
 * Passes the extension its one-time code for the same support session. The
 * extension's content script on this site answers; no answer means it is not
 * installed (or not on this browser). The code leaves the address bar either way.
 */
export function ExtensionHandoff({ code }: { code: string }) {
  const [state, setState] = useState<State>({ kind: "waiting" });

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete(SUPPORT_PARAM.extensionCode);
    window.history.replaceState(null, "", url);

    const onMessage = (event: MessageEvent<AcornSupportHandoffAck>) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type !== ACORN_SUPPORT_HANDOFF_ACK) return;
      window.clearTimeout(timer);
      setState(
        event.data.ok ? { kind: "linked" } : { kind: "failed", error: event.data.error ?? "" },
      );
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => setState({ kind: "missing" }), EXTENSION_ACK_TIMEOUT_MS);
    const message: AcornSupportHandoffMessage = { type: ACORN_SUPPORT_HANDOFF, code };
    window.postMessage(message, window.location.origin);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [code]);

  switch (state.kind) {
    case "waiting":
      return (
        <HStack gap={2} vAlign="center">
          <Spinner size="sm" />
          <Text color="secondary">Signing the Acorn extension in…</Text>
        </HStack>
      );
    case "linked":
      return (
        <Banner
          status="success"
          title="The extension is signed in as this user"
          description="Its sidebar shows a Support badge until the session ends."
        />
      );
    case "missing":
      return (
        <Banner
          status="info"
          title="The Acorn extension did not answer"
          description="Install or enable it in this browser, then open the support link again from the admin console."
        />
      );
    case "failed":
      return (
        <Banner
          status="warning"
          title="The extension could not sign in"
          description={state.error || "Open the support link again from the admin console."}
        />
      );
  }
}
