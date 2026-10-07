import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin-nav";
import { currentAdminEmail } from "@/lib/auth/session";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const email = await currentAdminEmail();
  if (!email) redirect("/login");
  return (
    <div className="acorn-admin-shell">
      <AdminNav email={email} />
      <div className="acorn-admin-main">{children}</div>
    </div>
  );
}
