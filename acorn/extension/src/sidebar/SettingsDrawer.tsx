import { Card, Drawer, HStack, StatusDot, Text, TextInput, VStack } from "sid-ui";

import { acornGmailConnectUrl } from "@acorn/shared/gmail";

import { DEFAULT_ACORN_API_URL, DEFAULT_ACORN_WEB_URL, setAcornApiUrl } from "../auth/acorn-auth";
import { ACORN_DEBUG } from "../debug-trace";

/** A debug build ignores the saved URL: only the local API records its debug runs. */
const API_URL_HELP = ACORN_DEBUG
  ? `Debug build: always ${DEFAULT_ACORN_API_URL}, the local API that records debug runs.`
  : "Where Acorn's routes and socket live. Leave as is unless you run your own.";

type SettingsDrawerProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  connected: boolean;
  signedIn: boolean;
  apiUrl: string;
  onApiUrlChange: (value: string) => void;
  gmailConnected?: boolean;
  gmailEmail?: string;
  gmailLoading?: boolean;
};

/** Connection and build details: the API URL, socket state, and Acorn's version. */
export function SettingsDrawer({
  isOpen,
  onOpenChange,
  connected,
  signedIn,
  apiUrl,
  onApiUrlChange,
  gmailConnected = false,
  gmailEmail,
  gmailLoading = false,
}: SettingsDrawerProps) {
  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Settings"
      subtitle={`Acorn v${import.meta.env.VITE_ACORN_VERSION}`}
      side="bottom"
      size="md"
    >
      <VStack gap={4}>
        <Card variant="muted" padding={3}>
          <HStack gap={2} align="center">
            <StatusDot
              variant={connected ? "success" : "neutral"}
              label={connected ? "Socket connected" : "Socket offline"}
              isPulsing={connected}
            />
            <VStack gap={0}>
              <Text weight="semibold">{connected ? "Connected" : "Offline"}</Text>
              <Text type="supporting">
                {connected
                  ? "Socket connected"
                  : signedIn
                    ? "Socket offline"
                    : "Sign in to connect"}
              </Text>
            </VStack>
          </HStack>
        </Card>
        <Card variant="muted" padding={3}>
          <HStack gap={2} align="center">
            <StatusDot
              variant={gmailLoading ? "neutral" : gmailConnected ? "success" : "neutral"}
              label={
                gmailLoading
                  ? "Checking Gmail…"
                  : gmailConnected
                    ? "Gmail connected"
                    : "Gmail not connected"
              }
              isPulsing={gmailLoading}
            />
            <VStack gap={0}>
              <Text weight="semibold">
                {gmailLoading
                  ? "Gmail"
                  : gmailConnected
                    ? "Gmail connected"
                    : "Gmail not connected"}
              </Text>
              <Text type="supporting">
                {gmailLoading
                  ? "Checking your Acorn account’s Gmail connection…"
                  : gmailConnected
                    ? gmailEmail
                      ? `Uses the same Gmail as the website (${gmailEmail}) for verification codes during runs.`
                      : "Uses the Gmail you connected under Connections on the Acorn website."
                    : signedIn
                      ? "Connect Gmail under Connections on the Acorn website; this extension reuses that link."
                      : "Sign in with the same account you use on the website, then connect Gmail there."}
              </Text>
              {!gmailLoading && signedIn && !gmailConnected ? (
                <Text
                  type="supporting"
                  role="link"
                  tabIndex={0}
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  onClick={() =>
                    void chrome.tabs.create({ url: acornGmailConnectUrl(DEFAULT_ACORN_WEB_URL) })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      void chrome.tabs.create({ url: acornGmailConnectUrl(DEFAULT_ACORN_WEB_URL) });
                    }
                  }}
                >
                  Open Connections on the Acorn website
                </Text>
              ) : null}
            </VStack>
          </HStack>
        </Card>
        <TextInput
          label="Acorn API URL"
          description={API_URL_HELP}
          value={apiUrl}
          onChange={(value) => {
            onApiUrlChange(value);
            void setAcornApiUrl(value);
          }}
          placeholder={DEFAULT_ACORN_API_URL}
        />
      </VStack>
    </Drawer>
  );
}
