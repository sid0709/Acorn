import { Dialog, DialogHeader } from "@astryxdesign/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banner,
  Button,
  ChartLegend,
  EmptyState,
  Glyph,
  HStack,
  IconButton,
  Spinner,
  Text,
  Tooltip,
  VStack,
  type ChartTone,
} from "sid-ui";

import {
  USAGE_FAILED_TONE,
  chronological,
  modelTones,
  shortModel,
  usageBarHeight,
  usageBarLabel,
  usageBarWidth,
  usageScale,
  type UsageScale,
} from "./usage-chart";
import {
  fetchUsageDetail,
  formatUsagePrice,
  type AiUsageEntry,
  type UsageDetail,
} from "./use-ai-usage";

type UsageHistoryListProps = {
  entries: AiUsageEntry[];
  totalPrice: string;
  loading: boolean;
  error: string | null;
  tabId: number | null;
  onRefresh: () => void;
};

type DetailTab = "request" | "response" | "error";

const CALL_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, CALL_TIME_FORMAT);
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

function prettyJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

/** One call: as wide as it was slow, as tall as it was costly, in its model's tone. */
function UsageBar({
  entry,
  scale,
  tone,
  onSelect,
}: {
  entry: AiUsageEntry;
  scale: UsageScale;
  tone: ChartTone;
  onSelect: () => void;
}) {
  const tip = [
    shortModel(entry.model),
    formatDuration(entry.durationMs),
    entry.priced ? formatUsagePrice(entry.price) : "unpriced",
    entry.error ? "failed" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Tooltip content={tip}>
      <span
        role="listitem"
        tabIndex={0}
        className="acorn-usage-mark"
        data-tone={tone}
        style={{
          width: `${usageBarWidth(entry.durationMs, scale)}px`,
          height: `${usageBarHeight(entry, scale)}%`,
        }}
        aria-label={`View ${usageBarLabel(entry)}`}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
      />
    </Tooltip>
  );
}

/** AI calls made from the active Chrome tab, oldest on the left and each new call added on the right. */
export function UsageHistoryList({
  entries,
  totalPrice,
  loading,
  error,
  tabId,
  onRefresh,
}: UsageHistoryListProps) {
  const [open, setOpen] = useState<AiUsageEntry | null>(null);
  const [detail, setDetail] = useState<UsageDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("request");

  const sorted = useMemo(() => chronological(entries), [entries]);
  const scale = useMemo(() => usageScale(sorted), [sorted]);
  const tones = useMemo(() => modelTones(sorted), [sorted]);
  const hasFailed = sorted.some((entry) => entry.error);
  const plotRef = useRef<HTMLDivElement>(null);

  // Keep the newest call in view as calls arrive.
  useEffect(() => {
    const plot = plotRef.current;
    if (plot) plot.scrollLeft = plot.scrollWidth;
  }, [sorted.length]);

  async function showDetail(entry: AiUsageEntry) {
    setOpen(entry);
    setDetail(null);
    setDetailError(null);
    setDetailTab(entry.error ? "error" : "request");
    if (tabId == null) {
      setDetailError("This tab is not ready.");
      return;
    }
    setDetailLoading(true);
    try {
      setDetail(await fetchUsageDetail(entry.id, tabId));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }

  const bodyText =
    detailTab === "request"
      ? detail?.request
      : detailTab === "response"
        ? detail?.response
        : (open?.error ?? "");

  return (
    <VStack as="section" gap={3} aria-label="AI usage">
      <HStack gap={2} align="center" justify="between">
        <VStack gap={0}>
          <Text as="h2" weight="semibold">
            AI usage
          </Text>
          <Text type="supporting">
            {entries.length === 0
              ? "This tab"
              : `Total ${formatUsagePrice(totalPrice)} · wider = slower · taller = costlier`}
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
      {sorted.length > 0 ? (
        <VStack gap={2}>
          <div
            ref={plotRef}
            className="acorn-usage-plot"
            role="list"
            aria-label="AI calls on this tab"
          >
            {sorted.map((entry) => (
              <UsageBar
                key={entry.id}
                entry={entry}
                scale={scale}
                tone={
                  entry.error ? USAGE_FAILED_TONE : (tones.get(entry.model || "Model") ?? "neutral")
                }
                onSelect={() => void showDetail(entry)}
              />
            ))}
          </div>
          <ChartLegend
            items={[
              ...[...tones].map(([model, tone]) => ({ label: shortModel(model), tone })),
              ...(hasFailed ? [{ label: "Failed", tone: USAGE_FAILED_TONE }] : []),
            ]}
          />
        </VStack>
      ) : null}
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
          title={open?.model || "AI call"}
          subtitle={
            open
              ? [
                  tokenLine(open),
                  formatDuration(open.durationMs),
                  formatWhen(open.createdAt),
                  open.priced ? formatUsagePrice(open.price) : "—",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
          onOpenChange={() => setOpen(null)}
        />
        <HStack gap={1} className="acorn-usage-detail-tabs">
          <Button
            variant={detailTab === "request" ? "secondary" : "ghost"}
            size="sm"
            label="Request"
            onClick={() => setDetailTab("request")}
          />
          <Button
            variant={detailTab === "response" ? "secondary" : "ghost"}
            size="sm"
            label="Response"
            onClick={() => setDetailTab("response")}
          />
          {open?.error ? (
            <Button
              variant={detailTab === "error" ? "secondary" : "ghost"}
              size="sm"
              label="Error"
              onClick={() => setDetailTab("error")}
            />
          ) : null}
        </HStack>
        {detailLoading ? <Spinner label="Loading call details" /> : null}
        {detailError ? (
          <Banner status="error" title="Couldn’t load call details" description={detailError} />
        ) : null}
        {!detailLoading && !detailError && bodyText ? (
          <pre className="acorn-usage-request">{prettyJson(bodyText)}</pre>
        ) : null}
        {!detailLoading && !detailError && !bodyText && detailTab !== "error" ? (
          <Text type="supporting">No {detailTab} body was stored for this call.</Text>
        ) : null}
      </Dialog>
    </VStack>
  );
}
