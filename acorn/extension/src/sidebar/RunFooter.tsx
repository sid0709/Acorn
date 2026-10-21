import { formatUsd } from "@acorn/shared/ai-usage";
import { Fragment } from "react";
import { Glyph, HStack, Text } from "sid-ui";

import { RunClock } from "./RunTimer";

import type { RunProgress } from "@acorn/shared/run-types";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A run's numbers in one line at the foot of the Now card: its clock, what the models have cost and how many
 * calls and screen checks that was (once the first answer is back), and the step it is on.
 */
export function RunFooter({ run }: { run: RunProgress }) {
  const parts = [
    run.costUsd != null ? formatUsd(run.costUsd) : "",
    run.costUsd != null && run.modelCalls != null ? plural(run.modelCalls, "model call") : "",
    run.screenChecks ? plural(run.screenChecks, "screen check") : "",
    run.step ? `Step ${run.step}` : `Page ${Math.max(run.page, 1)}`,
    run.refills > 0 ? `refill ${run.refills}/${run.maxRefills}` : "",
  ].filter(Boolean);
  return (
    <HStack gap={1.5} align="center" wrap="wrap" className="acorn-run-footer">
      <Glyph name="clock" />
      <RunClock startedAt={run.startedAt} endedAt={run.endedAt} />
      {parts.map((part) => (
        <Fragment key={part}>
          <Text type="supporting" color="disabled">
            ·
          </Text>
          <Text type="supporting" hasTabularNumbers>
            {part}
          </Text>
        </Fragment>
      ))}
    </HStack>
  );
}
