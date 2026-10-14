"use client";

import { useState } from "react";
import {
  BarChart,
  GridColumn,
  GridSystem,
  PageHeader,
  SectionCard,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Text,
} from "sid-ui";
import {
  BILLING_CYCLE_DAYS,
  CURRENT_PLAN_ID,
  currentCycle,
  planById,
  type BillingInterval,
} from "@/lib/billing";
import type { Activity } from "@/lib/workspace/activity";
import { addDays, formatDay } from "@/lib/workspace/dates";
import { useWorkspace } from "@/components/workspace/use-workspace";
import { PlanCards } from "./plan-cards";
import { UsageMeters } from "./usage-meters";

const CYCLES_SHOWN = 6;

export function BillingPanel({ activity }: { activity: Activity }) {
  const { workspace } = useWorkspace();
  const [interval, setBillingInterval] = useState<BillingInterval>("monthly");
  const { today, applications } = activity;
  const plan = planById(CURRENT_PLAN_ID);
  const cycle = currentCycle(today);

  const sentBetween = (from: string, to: string) =>
    applications.filter((app) => app.appliedOn && app.appliedOn >= from && app.appliedOn < to)
      .length;

  const cycles = Array.from({ length: CYCLES_SHOWN }, (_, index) => {
    const start = addDays(cycle.start, -(CYCLES_SHOWN - 1 - index) * BILLING_CYCLE_DAYS);
    return {
      label: formatDay(start),
      value: sentBetween(start, addDays(start, BILLING_CYCLE_DAYS)),
      tone: index === CYCLES_SHOWN - 1 ? ("blue" as const) : ("neutral" as const),
    };
  });

  return (
    <Stack gap={6}>
      <PageHeader
        title="Billing"
        description="Your plan and what the last 30 days have used."
        action={
          <SegmentedControl
            label="Billing interval"
            value={interval}
            onChange={(value) => setBillingInterval(value as BillingInterval)}
          >
            <SegmentedControlItem value="monthly" label="Monthly" />
            <SegmentedControlItem value="yearly" label="Yearly" />
          </SegmentedControl>
        }
      />
      <PlanCards current={plan.id} interval={interval} />
      <GridSystem gap={4} align="stretch">
        <GridColumn span="full" lg={7}>
          <SectionCard
            title="Last 30 days"
            description={`${formatDay(cycle.start)} – ${formatDay(today)}`}
          >
            <UsageMeters
              limits={plan.limits}
              used={{
                applications: sentBetween(cycle.start, addDays(today, 1)),
                drafts: workspace.resumes.length,
                mailboxes: workspace.mailboxes.length,
              }}
            />
          </SectionCard>
        </GridColumn>
        <GridColumn span="full" lg={5}>
          <SectionCard title="Payment method">
            <Text color="secondary">
              No payment method on file. Add one when you’re ready to upgrade; paid plans open once
              checkout launches.
            </Text>
          </SectionCard>
        </GridColumn>
        <GridColumn span="full">
          <SectionCard
            title="Applications per 30 days"
            description="The latest window is highlighted."
          >
            <BarChart label="Applications per 30-day window" data={cycles} height={180} />
          </SectionCard>
        </GridColumn>
      </GridSystem>
    </Stack>
  );
}
