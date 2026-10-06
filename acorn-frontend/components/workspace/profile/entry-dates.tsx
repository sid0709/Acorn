import { Grid, Selector, Stack, Switch } from "sid-ui";
import { MONTH_OPTIONS, YEAR_OPTIONS, type CareerEntry } from "@/lib/workspace/profile";
import { PAIR_WIDTH } from "./form-layout";

type Dates = Pick<
  CareerEntry,
  "kind" | "startMonth" | "startYear" | "endMonth" | "endYear" | "current"
>;

/** Start and end month and year, and whether the role is ongoing. */
export function EntryDates({
  entry,
  onChange,
}: {
  entry: Dates;
  onChange: (patch: Partial<CareerEntry>) => void;
}) {
  const role = entry.kind === "role";
  return (
    <Stack gap={3}>
      <Grid columns={{ minWidth: PAIR_WIDTH }} gap={3}>
        <Selector
          label="Start month"
          options={MONTH_OPTIONS}
          value={entry.startMonth}
          onChange={(startMonth) => onChange({ startMonth })}
          placeholder="Month"
        />
        <Selector
          label="Start year"
          options={YEAR_OPTIONS}
          value={entry.startYear}
          onChange={(startYear) => onChange({ startYear })}
          placeholder="Year"
        />
        {entry.current ? null : (
          <>
            <Selector
              label={role ? "End month" : "Graduation month"}
              options={MONTH_OPTIONS}
              value={entry.endMonth}
              onChange={(endMonth) => onChange({ endMonth })}
              placeholder="Month"
            />
            <Selector
              label={role ? "End year" : "Graduation year"}
              options={YEAR_OPTIONS}
              value={entry.endYear}
              onChange={(endYear) => onChange({ endYear })}
              placeholder="Year"
            />
          </>
        )}
      </Grid>
      <Switch
        label={role ? "I currently work here" : "I’m still studying here"}
        value={entry.current}
        onChange={(current) =>
          onChange(current ? { current, endMonth: "", endYear: "" } : { current })
        }
      />
    </Stack>
  );
}
