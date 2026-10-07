"use client";

import { useRouter } from "next/navigation";
import { Banner, Button } from "sid-ui";
import { signOut } from "@/lib/auth/actions";
import type { AcornAccount } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

const endTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** Shown on every page while an admin is signed in as the user. */
export function SupportBanner({
  account,
}: {
  account: AcornAccount & { support: NonNullable<AcornAccount["support"]> };
}) {
  const router = useRouter();
  const ends = Date.parse(account.support.expiresAt);
  return (
    <Banner
      status="warning"
      title={`Support session as ${account.name}`}
      description={`Opened by ${account.support.by}${Number.isFinite(ends) ? ` · ends ${endTime.format(ends)}` : ""}`}
      endContent={
        <Button
          label="End support session"
          variant="secondary"
          size="sm"
          onClick={() => void signOut().then(() => router.push(ROUTES.signIn))}
        />
      }
    />
  );
}
