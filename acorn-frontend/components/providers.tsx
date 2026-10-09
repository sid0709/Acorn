"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AppTheme } from "@acorn/app-theme";

/**
 * Links keep Next's default prefetch: a workspace page reads the session, so only
 * its frame and loading state are fetched ahead of a click. The click shows that
 * frame at once and the page's data streams into it. Prefetching every page in
 * full would render all of them on the server whenever the nav appears.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AppTheme mode="light" linkComponent={Link}>
      {children}
    </AppTheme>
  );
}
