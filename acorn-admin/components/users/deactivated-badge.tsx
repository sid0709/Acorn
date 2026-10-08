import { Badge } from "sid-ui";

import { formatDate } from "@/lib/format";

/** Marks an account the user deleted. Pass `at` when the date should show. */
export function DeactivatedBadge({ at }: { at?: string | null }) {
  return <Badge label={at ? `Deactivated ${formatDate(at)}` : "Deactivated"} variant="warning" />;
}
