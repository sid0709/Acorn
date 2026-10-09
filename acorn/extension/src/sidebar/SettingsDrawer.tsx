import { Card, Drawer, HStack, StatusDot, Text, TextInput, VStack } from "sid-ui";

import { DEFAULT_ACORN_API_URL, setAcornApiUrl } from "../auth/acorn-auth";
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
};

/** Connection and build details: the API URL, socket state, and Acorn's version. */
export function SettingsDrawer({
  isOpen,
  onOpenChange,
  connected,
  signedIn,
  apiUrl,
  onApiUrlChange,
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
