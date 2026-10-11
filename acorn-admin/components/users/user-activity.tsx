import { AuditCard } from "./audit-card";
import { RecentCalls } from "./recent-calls";

import { listUserAudit, listUserUsage } from "@/lib/api/users";

/** The user's recent model calls. Loads on its own, so the page above it shows first. */
export async function UserRecentCalls({ id, page }: { id: string; page: number }) {
  const calls = await listUserUsage(id, page);
  return (
    <RecentCalls
      entries={calls.entries}
      total={calls.total}
      page={calls.page}
      pageSize={calls.pageSize}
    />
  );
}

/** The user's support-session trail, loaded on its own. */
export async function UserAudit({ id }: { id: string }) {
  return <AuditCard entries={await listUserAudit(id)} />;
}
