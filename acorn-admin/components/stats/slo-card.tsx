import { Badge, HStack, SectionCard, Stack, StackItem, Text, type BadgeVariant } from "sid-ui";

import type { SLO, SLOStatus } from "@/lib/statistics/types";

import { formatMs, formatPercent } from "@/lib/format";

const STATUS: Record<SLOStatus, { label: string; variant: BadgeVariant }> = {
  met: { label: "Met", variant: "success" },
  at_risk: { label: "At risk", variant: "warning" },
  breached: { label: "Breached", variant: "error" },
  no_data: { label: "No data", variant: "neutral" },
};

function value(slo: SLO, n: number) {
  return slo.unit === "ms" ? formatMs(n) : formatPercent(n);
}

/** Each service-level objective, its target, and how the period measured up. */
export function SloCard({ slos }: { slos: SLO[] }) {
  return (
    <SectionCard title="Service levels" description="Targets for the selected period.">
      <Stack gap={4}>
        {slos.map((slo) => (
          <HStack key={slo.key} gap={3} vAlign="center">
            <StackItem size="fill">
              <Stack gap={0.5}>
                <Text weight="medium">{slo.label}</Text>
                <Text type="supporting" color="secondary">
                  {`Target ${slo.comparator === "at_least" ? "≥" : "≤"} ${value(slo, slo.target)}`}
                  {slo.status === "no_data" ? "" : ` · now ${value(slo, slo.actual)}`}
                </Text>
              </Stack>
            </StackItem>
            <Badge label={STATUS[slo.status].label} variant={STATUS[slo.status].variant} />
          </HStack>
        ))}
      </Stack>
    </SectionCard>
  );
}
