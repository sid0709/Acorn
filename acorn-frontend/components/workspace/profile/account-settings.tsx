"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog, Banner, Button, FormLayout, SectionCard, Stack, TextInput } from "sid-ui";
import { deleteAccount } from "@/lib/auth/actions";
import { ROUTES } from "@/lib/routes";
import { WORKSPACE_STORAGE_KEY } from "@/lib/workspace/model";
import { SECRET_MAX, type ApplicantProfile, type SetProfileField } from "@/lib/workspace/profile";

/** Account email, extension sign-in password, and delete. */
export function AccountSettings({
  email,
  profile,
  onChange,
}: {
  email: string;
  profile: ApplicantProfile;
  onChange: SetProfileField;
}) {
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
    <Stack gap={4}>
      <SectionCard
        title="Extension sign-in"
        description="The Acorn extension signs in with your profile email and this password — not your website password."
      >
        <FormLayout>
          <TextInput label="Account email" value={email} isReadOnly />
          <TextInput
            label="Extension password"
            type="password"
            value={profile.extensionPassword}
            onChange={(value) => onChange("extensionPassword", value.slice(0, SECRET_MAX))}
            description="Use the same email as on your profile Identity tab (or this account email)."
          />
        </FormLayout>
      </SectionCard>
      <SectionCard
        title="Delete account"
        description="Deactivates this account. You are signed out and cannot sign in again."
      >
        <Stack gap={3}>
          {error ? <Banner status="error" title={error} /> : null}
          <Button label="Delete account" variant="destructive" onClick={() => setOpen(true)} />
        </Stack>
        <AlertDialog
          isOpen={open}
          onOpenChange={(next) => {
            if (!busy) setOpen(next);
          }}
          title="Delete this account?"
          description={`This deactivates ${email}. You are signed out and cannot sign in again.`}
          actionLabel="Delete account"
          isActionLoading={busy}
          onAction={() => {
            void remove();
          }}
        />
      </SectionCard>
    </Stack>
  );
}
