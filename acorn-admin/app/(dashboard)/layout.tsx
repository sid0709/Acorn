import { redirect } from "next/navigation";

import type { ReactNode } from "react";

import { AdminHeader } from "@/components/shell/admin-header";
import { MobileAdminNav } from "@/components/shell/admin-nav";
import { AppFrame } from "@/components/shell/app-frame";
import { listClaims } from "@/lib/api/claims";
import { currentAdminEmail } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const email = await currentAdminEmail();
  if (!email) redirect(ROUTES.login);
  const { awaitingSupport } = await listClaims("open", "").catch(() => ({ awaitingSupport: 0 }));
  return (
    <AppFrame header={<AdminHeader email={email} awaitingSupport={awaitingSupport} />}>
      {children}
      <MobileAdminNav awaitingSupport={awaitingSupport} />
    </AppFrame>
  );
}
