"use client";

import { useState, type FormEvent } from "react";
import { GMAIL_AUTH_ROUTE } from "@acorn/google-gmail";
import { Banner, Button, Stack, Text, TextInput } from "sid-ui";
import { ROUTES } from "@/lib/routes";
import { MAILBOX_LABEL_MAX, isEmail } from "@/lib/workspace/model";

/** Pick the Gmail to connect; OAuth uses this address as a hint, not your Acorn login. */
export function GmailConnectForm({
  next = ROUTES.gmail,
  error = "",
}: {
  next?: string;
  error?: string;
}) {
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [localError, setLocalError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const address = email.trim().toLowerCase();
    if (!isEmail(address)) {
      event.preventDefault();
      setLocalError("Enter a full Gmail address.");
      return;
    }
    setLocalError("");
  };

  return (
    <Stack gap={5}>
      <Text color="secondary">
        Choose the Gmail inbox Acorn should read. This can differ from the email on your Acorn
        account.
      </Text>
      {error ? <Banner status="error" title={error} /> : null}
      {localError ? <Banner status="error" title={localError} /> : null}
      <form action={GMAIL_AUTH_ROUTE} method="post" onSubmit={submit}>
        <Stack gap={4}>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="email" value={email.trim().toLowerCase()} />
          <input type="hidden" name="label" value={label.trim()} />
          <TextInput
            label="Gmail address"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@gmail.com"
            autoComplete="email"
            isRequired
          />
          <TextInput
            label="Label in Acorn"
            value={label}
            onChange={(value) => setLabel(value.slice(0, MAILBOX_LABEL_MAX))}
            placeholder="Applications"
            isOptional
          />
          <Button label="Connect with Google" variant="primary" type="submit" />
        </Stack>
      </form>
    </Stack>
  );
}
