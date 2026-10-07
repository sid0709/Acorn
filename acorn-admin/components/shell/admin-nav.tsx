"use client";

import { usePathname } from "next/navigation";
import { PillNav, useAppShellMobile, type PillNavItem } from "sid-ui";

import { BRAND } from "@/lib/config";
import { ROUTES } from "@/lib/routes";

/** The console's pages; Claims carries how many reports wait on support. */
function items(awaitingSupport: number): PillNavItem[] {
  return [
    { href: ROUTES.statistics, label: "Statistics", icon: "home" },
    { href: ROUTES.users, label: "Users", icon: "users" },
    { href: ROUTES.claims, label: "Claims", icon: "chat", count: awaitingSupport || undefined },
  ];
}

function activeFor(pathname: string, list: PillNavItem[]) {
  const match = list.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return match?.href ?? ROUTES.statistics;
}

export function AdminNav({
  awaitingSupport,
  placement = "top",
}: {
  awaitingSupport: number;
  placement?: "top" | "bottom";
}) {
  const list = items(awaitingSupport);
  return (
    <PillNav
      label={BRAND}
      items={list}
      activeHref={activeFor(usePathname(), list)}
      placement={placement}
    />
  );
}

/** On small screens the pills move to a bar along the bottom edge. */
export function MobileAdminNav({ awaitingSupport }: { awaitingSupport: number }) {
  const { isMobile } = useAppShellMobile();
  return isMobile ? <AdminNav awaitingSupport={awaitingSupport} placement="bottom" /> : null;
}
