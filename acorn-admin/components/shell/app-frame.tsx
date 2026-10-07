import { AppShell, PageContainer } from "sid-ui";

import type { ReactNode } from "react";

const CONTENT_PADDING = 5;

/** The console frame: the admin bar on top, the page below in a wide column. */
export function AppFrame({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <AppShell variant="surface" topNav={header} mobileNav={false} contentPadding={CONTENT_PADDING}>
      <PageContainer width="wide">{children}</PageContainer>
    </AppShell>
  );
}
