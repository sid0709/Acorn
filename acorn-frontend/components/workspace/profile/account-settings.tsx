"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog, Banner, Button, SectionCard, Stack, Text } from "sid-ui";
import { deleteAccount } from "@/lib/auth/actions";
import { ROUTES } from "@/lib/routes";
import { WORKSPACE_STORAGE_KEY } from "@/lib/workspace/model";

/** Deletes the signed-in account and the profile and résumés stored with it. */
export function AccountSettings({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = async () => {
    setBusy(true);
    setError("");
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    const result = await deleteAccount();
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    setOpen(false);
    router.push(ROUTES.signIn);
    router.refresh();
  };

  return (
    <SectionCard
      title="Account"
      description="Deleting the account also deletes the profile, résumé library, templates, and generation history."
    >
      <Stack gap={3}>
        {error ? <Banner status="error" title={error} /> : null}
        <Text color="secondary">{email}</Text>
        <Button label="Delete account" variant="destructive" onClick={() => setOpen(true)} />
      </Stack>
      <AlertDialog
        isOpen={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
        title="Delete this account?"
        description={`This permanently deletes ${email}, including the profile, résumés, templates, and generation history.`}
        actionLabel="Delete account"
        isActionLoading={busy}
        onAction={() => {
          void remove();
        }}
      />
    </SectionCard>
  );
}
