import Link from "next/link";
import { Text, VStack } from "sid-ui";

import { listClaims } from "@/lib/api/admin-data";

export default async function ClaimsPage() {
  const claims = await listClaims();
  return (
    <VStack gap={4}>
      <Text as="h1" type="large" weight="semibold">
        Support claims
      </Text>
      <table className="acorn-admin-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>User</th>
            <th>Page</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => (
            <tr key={claim.id}>
              <td>{claim.status}</td>
              <td>
                <Link href={`/claims/${claim.id}`}>{claim.userEmail}</Link>
              </td>
              <td>
                <a href={claim.pageUrl} target="_blank" rel="noreferrer">
                  {claim.pageTitle || claim.pageUrl}
                </a>
              </td>
              <td>{new Date(claim.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {claims.length === 0 ? <Text type="supporting">No claims yet.</Text> : null}
    </VStack>
  );
}
