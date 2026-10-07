import Link from "next/link";
import { notFound } from "next/navigation";
import { Text, VStack } from "sid-ui";

import { getUser, listUserUsage } from "@/lib/api/admin-data";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getUser(id);
  if (!detail) notFound();
  const { user, usage } = detail;
  const rows = await listUserUsage(id);
  return (
    <VStack gap={4}>
      <Link href="/users">← Users</Link>
      <Text as="h1" type="large" weight="semibold">
        {user.name}
      </Text>
      <Text type="supporting">{user.email}</Text>
      <Text type="supporting">
        {usage.callCount.toLocaleString()} calls · {usage.totalTokens.toLocaleString()} tokens ·{" "}
        {usage.totalPrice} estimated · last{" "}
        {usage.lastCallAt ? new Date(usage.lastCallAt).toLocaleString() : "—"}
      </Text>
      <table className="acorn-admin-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Model</th>
            <th>Tab</th>
            <th>Tokens</th>
            <th>Duration</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.createdAt).toLocaleString()}</td>
              <td>{row.model}</td>
              <td>{row.tabKey}</td>
              <td>{row.totalTokens.toLocaleString()}</td>
              <td>{row.durationMs} ms</td>
              <td>{row.priced ? row.price : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </VStack>
  );
}
