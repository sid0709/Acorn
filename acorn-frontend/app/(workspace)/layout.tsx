import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { PageContainer } from "sid-ui";
import { AcornHeader } from "@/components/shell/acorn-header";
import { AppFrame } from "@/components/shell/app-frame";
import { MobileWorkspaceNav } from "@/components/workspace/nav";
import { SupportBanner } from "@/components/support/support-banner";
import { ProfileSync } from "@/components/workspace/profile-sync";
import { WorkspaceScope } from "@/components/workspace/workspace-scope";
import { currentAccount } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  return (
    <AppFrame header={<AcornHeader account={account} />}>
      <WorkspaceScope accountId={account.id} support={Boolean(account.support)}>
        <ProfileSync />
        <PageContainer width="wide">
          {account.support ? (
            <SupportBanner account={{ ...account, support: account.support }} />
          ) : null}
          {children}
        </PageContainer>
        <MobileWorkspaceNav />
      </WorkspaceScope>
    </AppFrame>
  );
}
