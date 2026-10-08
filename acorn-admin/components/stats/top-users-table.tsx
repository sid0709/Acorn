"use client";

import { useRouter } from "next/navigation";
import { Avatar, HStack, SectionCard, Stack, Table, Text, type TableColumn } from "sid-ui";

import type { AccountNames, Group } from "@/lib/statistics/types";

import { DeactivatedBadge } from "@/components/users/deactivated-badge";
import { formatCount, formatPercent, formatUSD } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

const AVATAR_SIZE = 32;

type Row = Group & { name: string; email: string; deactivatedAt?: string | null };

const columns: TableColumn<Row>[] = [
  {
    key: "name",
    header: "User",
    render: (r) => (
      <HStack gap={2} vAlign="center">
        <Avatar name={r.name} size={AVATAR_SIZE} tooltip={false} />
        <Stack gap={0}>
          <HStack gap={2} vAlign="center">
            <Text weight="medium" maxLines={1}>
              {r.name}
            </Text>
            {r.deactivatedAt ? <DeactivatedBadge /> : null}
          </HStack>
          <Text type="supporting" color="secondary" maxLines={1}>
            {r.email}
          </Text>
        </Stack>
      </HStack>
    ),
  },
  { key: "calls", header: "Calls", align: "end", render: (r) => formatCount(r.calls) },
  {
    key: "successRate",
    header: "Success",
    align: "end",
    render: (r) => formatPercent(r.successRate),
  },
  { key: "costNanos", header: "Spend", align: "end", render: (r) => formatUSD(r.costNanos) },
];

/** The accounts that cost the most this period; a row opens the user. */
export function TopUsersTable({ groups, accounts }: { groups: Group[]; accounts: AccountNames }) {
  const router = useRouter();
  const rows: Row[] = groups.map((g) => ({
    ...g,
    name: accounts[g.key]?.name || "Deleted account",
    email: accounts[g.key]?.email ?? g.key,
    deactivatedAt: accounts[g.key]?.deactivatedAt,
  }));
  return (
    <SectionCard title="Top users by spend">
      <Table
        variant="plain"
        density="compact"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        onRowClick={(r) => router.push(ROUTES.user(r.key))}
        empty="No AI use in this period."
      />
    </SectionCard>
  );
}
