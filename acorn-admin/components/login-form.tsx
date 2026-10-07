"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner, Button, Card, Text, TextInput, VStack } from "sid-ui";

import { signInActionWithError } from "@/lib/actions/auth";
import { HOME_ROUTE } from "@/lib/routes";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Card padding={6} elevation="low">
      <VStack gap={4}>
        <Text as="h1" type="large" weight="semibold">
          Acorn Admin
        </Text>
        <Text type="supporting">Staff sign-in for support claims, user lookup, and AI usage.</Text>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            void signInActionWithError(email, password)
              .then((message) => {
                if (message) {
                  setError(message);
                  return;
                }
                router.replace(HOME_ROUTE);
                router.refresh();
              })
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : String(err));
              })
              .finally(() => setBusy(false));
          }}
        >
          <VStack gap={3}>
            <TextInput
              label="Email"
              value={email}
              autoComplete="username"
              onChange={(value) => setEmail(value)}
            />
            <TextInput
              label="Password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(value) => setPassword(value)}
            />
            {error ? <Banner status="error" title="Sign-in failed" description={error} /> : null}
            <Button
              variant="primary"
              label="Sign in"
              type="submit"
              isDisabled={busy}
              width="100%"
            />
          </VStack>
        </form>
      </VStack>
    </Card>
  );
}
