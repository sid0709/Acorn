import { Grid, KpiWidget, Sparkline } from "sid-ui";
import { deltaOf, type Summary, type Weekly } from "@/lib/workspace/stats";
import { SampleBadge } from "./sample-badge";

const KPI_MIN_WIDTH = 200;
const KPI_COLUMNS = 2;

/** The supporting numbers under the hero row, each against the window before it. */
export function KpiRow({
  current,
  previous,
  trend,
}: {
  current: Summary;
  previous: Summary;
  trend: Weekly;
}) {
  return (
    <Grid columns={{ minWidth: KPI_MIN_WIDTH, max: KPI_COLUMNS }} gap={4}>
      <KpiWidget
        label="Waiting on a reply"
        value={current.waiting.toLocaleString()}
        delta={deltaOf(current.waiting, previous.waiting, { lowerIsBetter: true })}
        hint={`Of ${current.applied} sent in this period`}
        action={<SampleBadge />}
      />
      <KpiWidget
        label="Days to first reply"
        value={current.medianReplyDays === null ? "—" : String(current.medianReplyDays)}
        delta={
          current.medianReplyDays !== null && previous.medianReplyDays !== null
            ? deltaOf(current.medianReplyDays, previous.medianReplyDays, {
                unit: "d",
                lowerIsBetter: true,
              })
            : undefined
        }
        hint="Median wait after applying"
        action={<SampleBadge />}
      >
        <Sparkline label="Median days to reply per week" values={trend.replyDays} tone="green" />
      </KpiWidget>
    </Grid>
  );
}
