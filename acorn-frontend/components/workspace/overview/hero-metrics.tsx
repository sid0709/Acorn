import type { ReactNode } from "react";
import { Badge, Card, Grid, HStack, Heading, Sparkline, Stack, Text } from "sid-ui";
import {
  appliedContext,
  deltaOf,
  replyRateContext,
  type Summary,
  type Weekly,
} from "@/lib/workspace/stats";
import { SampleBadge } from "./sample-badge";

const HERO_MIN_WIDTH = 280;
const HERO_COLUMNS = 2;
const DELTA_VARIANT = { up: "success", down: "error", flat: "neutral" } as const;

type Hero = {
  label: string;
  value: string;
  delta: ReturnType<typeof deltaOf>;
  context: string;
  sparkline: ReactNode;
};

/** The two numbers the page is about: how much Acorn sent, and how much of it got answered. */
export function HeroMetrics({
  current,
  previous,
  trend,
}: {
  current: Summary;
  previous: Summary;
  trend: Weekly;
}) {
  const heroes: Hero[] = [
    {
      label: "Applications sent",
      value: current.applied.toLocaleString(),
      delta: deltaOf(current.applied, previous.applied),
      context: appliedContext(current, previous),
      sparkline: <Sparkline label="Applications per week" values={trend.applied} />,
    },
    {
      label: "Reply rate",
      value: `${current.responseRate}%`,
      delta: deltaOf(current.responseRate, previous.responseRate, { unit: "pts" }),
      context: replyRateContext(current, previous),
      sparkline: <Sparkline label="Reply rate per week" values={trend.rate} tone="orange" />,
    },
  ];
  return (
    <Grid columns={{ minWidth: HERO_MIN_WIDTH, max: HERO_COLUMNS }} gap={4}>
      {heroes.map((hero) => (
        <Card key={hero.label} padding={6}>
          <Stack gap={4}>
            <HStack hAlign="between" vAlign="center" gap={2}>
              <Text color="secondary" weight="semibold">
                {hero.label}
              </Text>
              <SampleBadge />
            </HStack>
            <HStack gap={3} vAlign="end" wrap="wrap">
              <Heading level={2} type="display-1">
                {hero.value}
              </Heading>
              {hero.delta ? (
                <Badge label={hero.delta.value} variant={DELTA_VARIANT[hero.delta.direction]} />
              ) : null}
            </HStack>
            {hero.sparkline}
            <Text color="secondary" display="block">
              {hero.context}
            </Text>
          </Stack>
        </Card>
      ))}
    </Grid>
  );
}
