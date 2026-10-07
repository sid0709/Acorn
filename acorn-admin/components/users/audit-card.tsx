import { EmptyState, Glyph, SectionCard, Timeline } from "sid-ui";

import type { AuditEntry } from "@/lib/api/users";

import { formatDateTime } from "@/lib/format";

const ACTIONS: Record<string, string> = {
  support_session_start: "Opened a support session",
  support_session_extension: "Linked the extension",
  support_sessions_revoked: "Ended support sessions",
};

/** Every time support signed in as this user, and why. */
export function AuditCard({ entries }: { entries: AuditEntry[] }) {
  return (
    <SectionCard title="Support access" description="Who signed in as this user, and why.">
      {entries.length === 0 ? (
        <EmptyState isCompact icon={<Glyph name="lock" />} title="No support sessions" />
      ) : (
        <Timeline
          items={entries.map((entry) => ({
            id: entry.id,
            title: ACTIONS[entry.action] ?? entry.action,
            description: entry.reason ? `${entry.admin} · “${entry.reason}”` : entry.admin,
            time: formatDateTime(entry.at),
          }))}
        />
      )}
    </SectionCard>
  );
}
