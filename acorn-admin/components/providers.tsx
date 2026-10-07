"use client";

import { AppTheme } from "@acorn/app-theme";
import Link from "next/link";

import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AppTheme mode="light" linkComponent={Link}>
      {children}
    </AppTheme>
  );
}
