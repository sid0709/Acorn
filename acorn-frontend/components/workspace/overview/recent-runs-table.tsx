"use client";

import { formatDuration } from "@acorn/shared/ai-usage";
import type { CompletedRun } from "@acorn/shared/runs";
import { Link, Stack, Table, Text, type TableColumn } from "sid-ui";
import { formatDay, formatTime } from "@/lib/workspace/dates";
import { describeRun, formatCost } from "@/lib/workspace/progress";

import { RunScreenshot } from "./run-screenshot";

const PAGE_SIZE = 6;

/** A job: its title as a link that opens the page it was on, and where that is. */
function JobCell({ run }: { run: CompletedRun }) {
  const job = describeRun(run);
  return (
    <Stack gap={0}>
      {job.href ? (
        <Link href={job.href} isExternalLink>
          {job.title}
        </Link>
      ) : (
        <Text weight="semibold">{job.title}</Text>
      )}
      {job.where ? (
        <Text type="supporting" color="secondary">
          {job.where}
        </Text>
      ) : null}
    </Stack>
  );
}

const COLUMNS: TableColumn<CompletedRun>[] = [
  {
    key: "screenshot",
    header: "Preview",
    render: (run) => <RunScreenshot run={run} />,
  },
  {
    key: "title",
    header: "Job",
    sortable: true,
    sortValue: (run) => describeRun(run).title.toLowerCase(),
    render: (run) => <JobCell run={run} />,
  },
  {
    key: "endedAt",
    header: "Sent",
    sortable: true,
    sortValue: (run) => run.endedAt,
    render: (run) => (
      <Text color="secondary">
        {formatDay(run.day)} · {formatTime(run.minute)}
      </Text>
    ),
  },
  {
    key: "durationMs",
    header: "Time",
    align: "end",
    sortable: true,
    render: (run) => <Text hasTabularNumbers>{formatDuration(run.durationMs)}</Text>,
  },
  {
    key: "costNanos",
    header: "Spent",
    align: "end",
    sortable: true,
    render: (run) => <Text hasTabularNumbers>{formatCost(run.costNanos)}</Text>,
  },
];

/** The newest applications Acorn sent: each with the job's link, when it went in, how long it took and what it cost. */
export function RecentRunsTable({ runs }: { runs: CompletedRun[] }) {
  return (
    <Table
      caption="Applications sent by Acorn"
      variant="plain"
      columns={COLUMNS}
      rows={runs}
      rowKey={(run) => run.id}
      pageSize={PAGE_SIZE}
      defaultSort={{ key: "endedAt", direction: "desc" }}
    />
  );
}
