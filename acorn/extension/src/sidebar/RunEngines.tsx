import { formatDuration, formatUsd } from "@acorn/shared/ai-usage";
import { HStack, Text, VStack } from "sid-ui";

import type { RunEngineStats, RunProgress } from "@acorn/shared/run-types";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Row({ name, detail, stats }: { name: string; detail: string; stats: RunEngineStats }) {
  return (
    <VStack gap={0}>
      <HStack gap={2} align="center" justify="between">
        <Text type="supporting" weight="semibold">
          {stats.active ? `${name} · working` : name}
        </Text>
        <Text type="supporting" hasTabularNumbers>
          {formatDuration(stats.ms)} · {formatUsd(stats.costUsd)}
        </Text>
      </HStack>
      <Text type="supporting">
        {[detail, plural(stats.calls, "model call")].filter(Boolean).join(" · ")}
      </Text>
    </VStack>
  );
}

/**
 * Which way of working did what in an agent Run: the DOM quick pass (the page read as text and typed
 * with real input) and the screenshot agent, each with its time, money and calls. The DOM row shows
 * only for a run that has the pass on; the image row is the rest of the run.
 */
export function RunEngines({ run }: { run: RunProgress }) {
  const { dom, image } = run;
  if (!dom && !image) return null;
  return (
    <VStack gap={1}>
      {dom ? (
        <Row
          name="DOM pass"
          detail={
            dom.rounds === 0 && !dom.active
              ? "not used yet"
              : [
                  plural(dom.rounds, "pass"),
                  `${dom.filled ?? 0} filled`,
                  dom.failed ? `${dom.failed} failed` : "",
                  dom.reviews ? plural(dom.reviews, "review") : "",
                  dom.advances ? `${dom.advances} advanced` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
          stats={dom}
        />
      ) : null}
      {image ? (
        <Row name="Image agent" detail={plural(image.rounds, "step")} stats={image} />
      ) : null}
    </VStack>
  );
}
