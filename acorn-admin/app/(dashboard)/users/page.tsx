import { PageHeader, Stack } from "sid-ui";

import type { Metadata } from "next";

import { UsersSearch } from "@/components/users/users-search";
import { UsersTable } from "@/components/users/users-table";
import { listUsers } from "@/lib/api/users";
import { formatCount } from "@/lib/format";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page = "1" } = await searchParams;
  const result = await listUsers(q, Number(page) || 1);
  return (
    <Stack gap={6}>
      <PageHeader
        title="Users"
        description={`${formatCount(result.total)} accounts · AI use over the last 30 days`}
      />
      <UsersSearch initial={q} />
      <UsersTable
        users={result.users}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
      />
    </Stack>
  );
}
