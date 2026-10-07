import { Badge } from "sid-ui";

import { CLAIM_STATUS, CLAIM_STATUS_LABEL, type ClaimStatus } from "./types";

/** Opened or Closed. */
export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <Badge
      label={CLAIM_STATUS_LABEL[status]}
      variant={status === CLAIM_STATUS.open ? "info" : "neutral"}
    />
  );
}
