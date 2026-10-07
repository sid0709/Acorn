import Link from "next/link";
import { Button, HStack, Text } from "sid-ui";

import { signOutAction } from "@/lib/auth/actions";

export function AdminNav({ email }: { email: string }) {
  return (
    <header className="acorn-admin-nav">
      <Text weight="semibold">Acorn Admin</Text>
      <HStack gap={4} align="center">
        <Link href="/claims">Claims</Link>
        <Link href="/users">Users</Link>
        <Text type="supporting">{email}</Text>
        <form action={signOutAction}>
          <Button variant="ghost" label="Sign out" type="submit" />
        </form>
      </HStack>
    </header>
  );
}
