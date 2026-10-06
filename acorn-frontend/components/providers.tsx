"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AppTheme } from "@acorn/app-theme";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AppTheme mode="light" linkComponent={Link}>
      {children}
    </AppTheme>
  );
}
