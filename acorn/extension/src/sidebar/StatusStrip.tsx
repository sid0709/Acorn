import { HStack, StatusIndicator } from "sid-ui";

import { AGENT_PREFILL } from "../agent/settings";

import type { GmailStatus } from "./use-gmail-status";

const VERSION = import.meta.env.VITE_ACORN_VERSION ?? "";

type StatusStripProps = {
  gmail: GmailStatus;
};

/**
 * What a person needs to see at a glance, always: which build this is, whether the fast DOM pass is on
 * (a build without it fills with the image agent alone, which is slower and costs more), and whether Gmail
 * is connected (a verification code is read from it during a run).
 */
export function StatusStrip({ gmail }: StatusStripProps) {
  return (
    <HStack as="div" className="acorn-status" gap={2} align="center" role="status">
      <StatusIndicator variant="neutral" appearance="soft" size="sm" label={`v${VERSION}`} />
      <StatusIndicator
        variant={AGENT_PREFILL ? "success" : "warning"}
        appearance="soft"
        size="sm"
        label={AGENT_PREFILL ? "Fast DOM pass on" : "Fast DOM pass off"}
      />
      <StatusIndicator
        variant={gmail.loading ? "neutral" : gmail.connected ? "success" : "warning"}
        appearance="soft"
        size="sm"
        isPulsing={gmail.loading}
        label={
          gmail.loading ? "Gmail…" : gmail.connected ? "Gmail connected" : "Gmail not connected"
        }
        detail={gmail.connected ? gmail.email : undefined}
      />
    </HStack>
  );
}
