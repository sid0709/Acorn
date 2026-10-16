import { formatUsd } from "@acorn/shared/ai-usage";
import { HStack, Text, VStack } from "sid-ui";

import type { RunProgress } from "@acorn/shared/run-types";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What an agent Run has cost: the models' money so far while it works, and the final amount
 * once it has ended, with how many model calls and screen checks that was. Nothing shows
 * until the first answer has come back, and none for a Run that does not report a cost.
 */
export function RunCost({ run }: { run: RunProgress }) {
  if (run.costUsd == null) return null;
  const parts = [
    run.modelCalls != null ? plural(run.modelCalls, "model call") : "",
    run.screenChecks ? plural(run.screenChecks, "screen check") : "",
  ].filter(Boolean);
  return (
    <VStack gap={0}>
      <HStack gap={2} align="center" justify="between">
        <Text type="supporting">{run.endedAt != null ? "Spent" : "Spent so far"}</Text>
        <Text type="large" weight="semibold" hasTabularNumbers>
          {formatUsd(run.costUsd)}
        </Text>
      </HStack>
      {parts.length ? <Text type="supporting">{parts.join(" · ")}</Text> : null}
    </VStack>
  );
}
