import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Glyph, HStack, Spinner, Text, VStack } from "sid-ui";

import {
  buildActivityFeed,
  formatActivityMs,
  latestRunItems,
  type ActivityItem,
  type ActivityStatus,
  type TimeShare,
} from "../activity-feed";
import { type TabLogEntry } from "../tab-log-session";

import { prettyText, sinceLabel } from "./log-view";
import { useTabLog } from "./use-tab-log";

/** The newest items shown first; the rest wait behind "Show all". */
const FEED_SHOWN = 14;
/** The most related log entries one open row prints; the Logs tab has them all. */
const RELATED_SHOWN = 12;
/** How often "running" is re-judged against the clock while the feed is on screen. */
const FEED_TICK_MS = 5_000;

const STATUS_BADGE: Record<ActivityStatus, "neutral" | "success" | "warning" | "error" | null> = {
  running: null,
  ok: "success",
  info: "neutral",
  warn: "warning",
  error: "error",
};

function StatusMark({ status }: { status: ActivityStatus }) {
  if (status === "running") return <Spinner label="Working" />;
  if (status === "error") return <Glyph name="close" />;
  if (status === "warn" || status === "info") return <Glyph name="info" />;
  return <Glyph name="check" />;
}

/** Where a run's time went: each part with its share, adding up to the whole. */
function TimeBreakdown({ shares, totalMs }: { shares: TimeShare[]; totalMs: number }) {
  return (
    <VStack gap={1} aria-label="Where the time went">
      {shares.map((share) => (
        <HStack key={share.label} gap={2} justify="between" align="center">
          <Text size="sm">{share.label}</Text>
          <Text size="sm" color="secondary">
            {formatActivityMs(share.ms)} · {Math.round((share.ms / totalMs) * 100)}%
          </Text>
        </HStack>
      ))}
      <HStack gap={2} justify="between" align="center">
        <Text size="sm" weight="semibold">
          Total
        </Text>
        <Text size="sm" weight="semibold">
          {formatActivityMs(totalMs)}
        </Text>
      </HStack>
    </VStack>
  );
}

/** One step: a collapsed row, and what is behind it only once it is opened. */
function ActivityRow({
  item,
  entries,
  runStartedAt,
}: {
  item: ActivityItem;
  entries: Map<string, TabLogEntry>;
  runStartedAt: number;
}) {
  const [open, setOpen] = useState(false);
  // Time between steps that nothing accounts for: shown, not hidden, and not expandable.
  if (item.synthetic === "gap") {
    return (
      <div className="activity-item activity-gap">
        <span className="activity-title">
          <Text size="sm" color="secondary">
            {item.title}
          </Text>
        </span>
        <Text size="sm" color="secondary">
          {sinceLabel(item.startedAt, runStartedAt)} · {formatActivityMs(item.ms)}
        </Text>
      </div>
    );
  }
  const related = open
    ? item.entryIds.flatMap((id) => {
        const found = entries.get(id);
        return found ? [found] : [];
      })
    : [];
  const badge = STATUS_BADGE[item.status];
  return (
    <details
      className={item.depth ? "activity-item activity-child" : "activity-item"}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="activity-summary">
        <StatusMark status={item.status} />
        <span className="activity-title">{item.title}</span>
        <Text size="sm" color="secondary">
          {sinceLabel(item.startedAt, runStartedAt)}
          {item.ms != null ? ` · ${formatActivityMs(item.ms)}` : ""}
        </Text>
      </summary>
      {open ? (
        <VStack gap={2}>
          <HStack gap={2} align="center">
            {badge ? <Badge variant={badge} label={item.status} /> : null}
            <Text size="sm" color="secondary">
              {new Date(item.t).toLocaleTimeString([], { hour12: false })}
              {item.page ? ` · page ${item.page}` : ""}
            </Text>
          </HStack>
          {item.summary ? <Text type="supporting">{item.summary}</Text> : null}
          {item.breakdown && item.ms ? (
            <TimeBreakdown shares={item.breakdown} totalMs={item.ms} />
          ) : null}
          {related.slice(0, RELATED_SHOWN).map((entry) => (
            <details key={entry.id} className="log-entry">
              <summary className="log-entry-summary">
                <span className="log-entry-title">{entry.title}</span>
              </summary>
              <pre className="log-code">
                <code>{prettyText(entry.text) || "(empty)"}</code>
              </pre>
            </details>
          ))}
          {related.length > RELATED_SHOWN ? (
            <Text size="sm" color="secondary">
              {related.length - RELATED_SHOWN} more entries are in the Logs tab.
            </Text>
          ) : null}
        </VStack>
      ) : null}
    </details>
  );
}

/**
 * The run as a story, step by step: what Acorn read, asked the AI, decided, clicked and
 * filled, newest last. It is a view over this tab's local log, so every row opens to the
 * log entries behind it.
 */
export function ActivityFeed({ tabId, active }: { tabId: number | null; active: boolean }) {
  const { entries } = useTabLog(tabId);
  const [now, setNow] = useState(() => Date.now());
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), FEED_TICK_MS);
    return () => clearInterval(timer);
  }, [active, entries.length]);

  const items = useMemo(() => latestRunItems(buildActivityFeed(entries, now)), [entries, now]);
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const shown = showAll ? items : items.slice(-FEED_SHOWN);
  // Every row's time is counted from the run's first step, so the rows add up to the run.
  const runStartedAt = items[0]?.startedAt ?? now;

  if (items.length === 0) {
    return (
      <EmptyState
        isCompact
        icon={<Glyph name="info" />}
        title="No activity yet"
        description="Press Run. Each step Acorn takes shows here, and opens to its details."
      />
    );
  }
  return (
    <VStack gap={2} aria-label="What Acorn is doing">
      <HStack gap={2} justify="between" align="center">
        <Text type="supporting" weight="semibold">
          Activity
        </Text>
        {items.length > FEED_SHOWN ? (
          <Button
            variant="ghost"
            size="sm"
            label={showAll ? "Show latest" : `Show all ${items.length}`}
            onClick={() => setShowAll((value) => !value)}
          />
        ) : null}
      </HStack>
      <VStack gap={1}>
        {shown.map((item) => (
          <ActivityRow key={item.id} item={item} entries={byId} runStartedAt={runStartedAt} />
        ))}
      </VStack>
    </VStack>
  );
}
