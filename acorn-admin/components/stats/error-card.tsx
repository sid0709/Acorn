"use client";

import { DonutChart, EmptyState, Glyph, SectionCard, Stack } from "sid-ui";

import type { Group, Summary } from "@/lib/statistics/types";

import { formatCount, formatPercent } from "@/lib/format";
import { errorKindLabel } from "@/lib/statistics/labels";

const DONUT_SIZE = 168;
const TONES = ["red", "orange", "purple", "blue", "neutral", "green"] as const;

/** Why calls failed, by kind, and how often. */
export function ErrorCard({ byErrorKind, summary }: { byErrorKind: Group[]; summary: Summary }) {
  return (
    <SectionCard
      title="Failures"
      description={`${formatPercent(summary.errorRate)} of calls failed · ${formatPercent(summary.cancelRate)} cancelled`}
    >
      {byErrorKind.length === 0 ? (
        <EmptyState
          isCompact
          icon={<Glyph name="check" />}
          title="No failures"
          description="Every call in this period answered."
        />
      ) : (
        <Stack gap={4} hAlign="center">
          <DonutChart
            label="Failures by kind"
            centerLabel="Failed"
            size={DONUT_SIZE}
            formatValue={formatCount}
            data={byErrorKind.map((g, i) => ({
              label: errorKindLabel(g.key),
              value: g.calls,
              tone: TONES[i % TONES.length],
            }))}
          />
        </Stack>
      )}
    </SectionCard>
  );
}
