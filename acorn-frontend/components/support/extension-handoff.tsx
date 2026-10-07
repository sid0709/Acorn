"use client";

import { Banner, HStack, Spinner, Text } from "sid-ui";
import { EXTENSION_CODE_TTL_MINUTES, SUPPORT_PARAM } from "@/lib/support";
import { useExtensionSupportSync } from "./use-extension-support-sync";

/** The code is used up once the extension answers; keep it out of history after that. */
function dropCodeFromAddress() {
  const url = new URL(window.location.href);
  url.searchParams.delete(SUPPORT_PARAM.extensionCode);
  window.history.replaceState(null, "", url);
}

/**
 * Signs the Acorn extension into this support session with the code the
 * sign-in link came with, and says how it went. The code stays in the address
 * until the extension answers, so reloading the page retries.
 */
export function ExtensionHandoff({ accountId, code }: { accountId: string; code?: string }) {
  const state = useExtensionSupportSync({
    accountId,
    initialCode: code,
    onCodeUsed: dropCodeFromAddress,
  });

  switch (state.kind) {
    case "checking":
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
          description={`Reload the Acorn extension in chrome://extensions (or install it), then reload this page within ${EXTENSION_CODE_TTL_MINUTES} minutes. Any Acorn page also signs it in while this session lasts.`}
        />
      );
    case "failed":
      return (
        <Banner
          status="warning"
          title="The extension could not sign in"
          description={state.error || "Reload any Acorn page to try again."}
        />
      );
  }
}
