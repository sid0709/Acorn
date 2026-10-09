"use client";

import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { AppTheme } from "@acorn/app-theme";

/**
 * Full prefetch. Workspace pages read the session, so Next treats them as dynamic
 * and otherwise skips prefetching them. `prefetch={true}` loads the whole route
 * ahead of the click and keeps it in the client cache.
 */
function AppLink({ prefetch = true, ...props }: ComponentProps<typeof Link>) {
  return <Link prefetch={prefetch} {...props} />;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AppTheme mode="light" linkComponent={AppLink}>
      {children}
    </AppTheme>
  );
}
