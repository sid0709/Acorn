import { useState } from "react";
import { Dialog, DialogHeader } from "@astryxdesign/core";
import { Banner, EmptyState, Glyph, HStack, IconButton, Spinner, Text, VStack } from "sid-ui";
import { fetchUsageRequest, formatUsagePrice, type AiUsageEntry } from "./use-ai-usage";

type UsageHistoryListProps = {
  entries: AiUsageEntry[];
  totalPrice: string;
  loading: boolean;
  error: string | null;
  tabId: number | null;
  onRefresh: () => void;
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) {
    const shown = seconds >= 10 ? Math.round(seconds).toString() : seconds.toFixed(1);
    return `${shown} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function tokenLine(entry: AiUsageEntry): string {
  const total = entry.totalTokens.toLocaleString();
  const cached = entry.cachedTokens ? ` (${entry.cachedTokens.toLocaleString()} cached)` : "";
  return `${total} tokens · ${entry.promptTokens.toLocaleString()} in${cached} · ${entry.completionTokens.toLocaleString()} out`;
}

function whenLine(entry: AiUsageEntry): string {
  const duration = formatDuration(entry.durationMs);
  const when = formatWhen(entry.createdAt);
  if (duration && when) return `${duration} · ${when}`;
  return duration || when;
}

/** AI calls made from the active Chrome tab, newest first. */
export function UsageHistoryList({
  entries,
  totalPrice,
  loading,
  error,
  tabId,
  onRefresh,
}: UsageHistoryListProps) {
  const [open, setOpen] = useState<AiUsageEntry | null>(null);
  const [request, setRequest] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);

  async function showRequest(entry: AiUsageEntry) {
    setOpen(entry);
    setRequest("");
    setRequestError(null);
    if (tabId == null) {
      setRequestError("This tab is not ready.");
      return;
    }
    setRequestLoading(true);
    try {
      setRequest(await fetchUsageRequest(entry.id, tabId));
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequestLoading(false);
    }
  }

  return (
    <VStack as="section" gap={3} aria-label="AI usage">
      <HStack gap={2} align="center" justify="between">
        <VStack gap={0}>
          <Text as="h2" weight="semibold">
            AI usage
          </Text>
          <Text type="supporting">
            {entries.length === 0 ? "This tab" : `Total ${formatUsagePrice(totalPrice)}`}
          </Text>
        </VStack>
        <IconButton
          variant="ghost"
          size="sm"
          icon={<Glyph name="refresh" />}
          label="Refresh AI usage"
          tooltip="Refresh"
          isDisabled={loading}
          onClick={onRefresh}
        />
      </HStack>
      {error ? <Banner status="error" title="Couldn’t load AI usage" description={error} /> : null}
      {!loading && !error && entries.length === 0 ? (
        <EmptyState
          isCompact
          title="No AI usage on this tab"
          description="Fill, Generate, Recommend, and Ask on this tab show up here."
        />
      ) : null}
      <VStack gap={2}>
        {entries.map((entry) => (
          <VStack key={entry.id} gap={0}>
            <HStack gap={2} align="center" justify="between">
              <Text weight="semibold" maxLines={1}>
                {entry.model || "Model"}
              </Text>
              <HStack gap={1} align="center">
                <Text weight="semibold">{entry.priced ? formatUsagePrice(entry.price) : "—"}</Text>
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<Glyph name="eye" />}
                  label={`View request for ${entry.model || "this call"}`}
                  tooltip="View request"
                  onClick={() => void showRequest(entry)}
                />
              </HStack>
            </HStack>
            <HStack gap={2} align="center" justify="between">
              <Text type="supporting" maxLines={1}>
                {tokenLine(entry)}
              </Text>
              <Text type="supporting">{whenLine(entry)}</Text>
            </HStack>
            {entry.error ? (
              <Text type="supporting" className="acorn-usage-error">
                {entry.error}
              </Text>
            ) : null}
          </VStack>
        ))}
      </VStack>
      <Dialog
        isOpen={open != null}
        purpose="info"
        width="min(560px, 100%)"
        maxHeight="80dvh"
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        <DialogHeader
          title={open?.model || "Request"}
          subtitle={
            open
              ? [tokenLine(open), formatDuration(open.durationMs)].filter(Boolean).join(" · ")
              : undefined
          }
          onOpenChange={() => setOpen(null)}
        />
        {requestLoading ? <Spinner label="Loading request" /> : null}
        {requestError ? (
          <Banner status="error" title="Couldn’t load the request" description={requestError} />
        ) : null}
        {!requestLoading && !requestError && request ? (
          <pre className="acorn-usage-request">{request}</pre>
        ) : null}
      </Dialog>
    </VStack>
  );
}
