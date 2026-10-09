"use client";

import { Glyph, HStack, Table, Text, type TableColumn } from "sid-ui";
import { COMPARISON, type Comparison } from "@/lib/landing";

const COLUMNS: TableColumn<Comparison>[] = [
  {
    key: "task",
    header: "Step",
    render: (row) => <Text weight="semibold">{row.task}</Text>,
  },
  {
    key: "manual",
    header: "Applying by hand",
    render: (row) => (
      <HStack gap={2} vAlign="center">
        <Glyph name="close" />
        <Text color="secondary">{row.manual}</Text>
      </HStack>
    ),
  },
  {
    key: "acorn",
    header: "Auto-bid with Acorn",
    render: (row) => (
      <HStack gap={2} vAlign="center">
        <Glyph name="check" />
        <Text weight="medium">{row.acorn}</Text>
      </HStack>
    ),
  },
];

/** Manual applications against auto-bid, step by step. Render functions keep this a client leaf. */
export function ComparisonTable() {
  return (
    <Table
      columns={COLUMNS}
      rows={COMPARISON}
      rowKey={(row) => row.task}
      variant="card"
      density="spacious"
      caption="Applying to jobs by hand compared with Acorn's auto-bid agent"
    />
  );
}
