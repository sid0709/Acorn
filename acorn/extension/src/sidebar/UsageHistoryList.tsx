import { Banner, EmptyState, Glyph, HStack, IconButton, Text, VStack } from "sid-ui";
import { formatUsagePrice, type AiUsageEntry } from "./use-ai-usage";

type UsageHistoryListProps = {
  entries: AiUsageEntry[];
  totalPrice: string;
  loading: boolean;
  error: string | null;
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

function tokenLine(entry: AiUsageEntry): string {
  const total = entry.totalTokens.toLocaleString();
  return `${total} tokens · ${entry.promptTokens.toLocaleString()} in · ${entry.completionTokens.toLocaleString()} out`;
}

/** AI calls made from the active Chrome tab, newest first. */
export function UsageHistoryList({
  entries,
  totalPrice,
  loading,
  error,
  onRefresh,
}: UsageHistoryListProps) {
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
              <Text weight="semibold">{entry.priced ? formatUsagePrice(entry.price) : "—"}</Text>
            </HStack>
            <HStack gap={2} align="center" justify="between">
              <Text type="supporting" maxLines={1}>
                {tokenLine(entry)}
              </Text>
              <Text type="supporting">{formatWhen(entry.createdAt)}</Text>
            </HStack>
          </VStack>
        ))}
      </VStack>
    </VStack>
  );
}
