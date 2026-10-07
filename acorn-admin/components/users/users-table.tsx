"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Avatar, Badge, HStack, Pagination, Stack, Table, Text, type TableColumn } from "sid-ui";

import type { UserRow } from "@/lib/api/users";

import { formatCount, formatDate, formatDateTime, formatPercent, formatUSD } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

const AVATAR_SIZE = 32;
/** A success rate under this reads as a warning. */
const SUCCESS_WARN = 0.95;

const columns: TableColumn<UserRow>[] = [
  {
    key: "name",
    header: "User",
    render: (r) => (
      <HStack gap={3} vAlign="center">
        <Avatar name={r.name || r.email} size={AVATAR_SIZE} tooltip={false} />
        <Stack gap={0}>
          <Text weight="medium" maxLines={1}>
            {r.name || "—"}
          </Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            {r.email}
          </Text>
        </Stack>
      </HStack>
    ),
  },
  { key: "createdAt", header: "Joined", render: (r) => formatDate(r.createdAt) },
  { key: "calls", header: "Calls (30d)", align: "end", render: (r) => formatCount(r.usage.calls) },
  {
    key: "success",
    header: "Success",
    align: "end",
    render: (r) =>
      r.usage.calls - r.usage.cancelled > 0 ? (
        <Badge
          label={formatPercent(r.usage.successRate)}
          variant={r.usage.successRate >= SUCCESS_WARN ? "success" : "warning"}
        />
      ) : (
        <Text color="secondary">—</Text>
      ),
  },
  { key: "cost", header: "Spend (30d)", align: "end", render: (r) => formatUSD(r.usage.costNanos) },
  {
    key: "last",
    header: "Last AI call",
    align: "end",
    render: (r) => formatDateTime(r.usage.lastCallAt),
  },
];

/** One page of users; a row opens the user, the pager moves through pages. */
export function UsersTable({
  users,
  total,
  page,
  pageSize,
}: {
  users: UserRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const goTo = (next: number) => {
    const search = new URLSearchParams(params.toString());
    search.set("page", String(next));
    router.push(`${pathname}?${search.toString()}`);
  };
  return (
    <Stack gap={4}>
      <Table
        columns={columns}
        rows={users}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(ROUTES.user(r.id))}
        empty="No users match."
      />
      {total > pageSize ? (
        <Pagination
          page={page}
          onChange={goTo}
          totalItems={total}
          pageSize={pageSize}
          variant="count"
          size="sm"
        />
      ) : null}
    </Stack>
  );
}
