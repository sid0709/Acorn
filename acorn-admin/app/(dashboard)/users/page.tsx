import Link from "next/link";
import { Text, VStack } from "sid-ui";

import { listUsers } from "@/lib/api/admin-data";

export default async function UsersPage() {
  const users = await listUsers();
  return (
    <VStack gap={4}>
      <Text as="h1" type="large" weight="semibold">
        Users
      </Text>
      <table className="acorn-admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <Link href={`/users/${user.id}`}>{user.name}</Link>
              </td>
              <td>{user.email}</td>
              <td>{new Date(user.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </VStack>
  );
}
