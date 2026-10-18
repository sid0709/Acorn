"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  DropdownMenu,
  Glyph,
  TopNavItem,
  icons,
  type DropdownMenuOption,
  type GlyphName,
} from "sid-ui";
import { ROUTES } from "@/lib/routes";

type NavEntry = { href: string; label: string; icon: GlyphName };

const ITEMS: NavEntry[] = [
  { href: ROUTES.overview, label: "Statistics", icon: "home" },
  { href: ROUTES.profile, label: "Profile", icon: "user" },
  { href: ROUTES.resume, label: "Résumé", icon: "file" },
  { href: ROUTES.connections, label: "Connections", icon: "link" },
];

const MOBILE_MENU_WIDTH = 240;

/** The entry whose page holds `pathname`; Résumé stays lit on /resume/library and /resume/history. */
function activeFor(pathname: string) {
  const match = ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.href ?? ROUTES.overview;
}

/** Every workspace page, each with its name beside its icon. */
export function WorkspaceNav() {
  const active = activeFor(usePathname());
  return (
    <>
      {ITEMS.map((item) => (
        <TopNavItem
          key={item.href}
          label={item.label}
          href={item.href}
          icon={<Glyph name={item.icon} />}
          isSelected={item.href === active}
        />
      ))}
    </>
  );
}

/** Below the desktop breakpoint the pages collapse into one labelled menu. */
export function MobileWorkspaceNav() {
  const router = useRouter();
  const active = activeFor(usePathname());
  const items: DropdownMenuOption[] = ITEMS.map((item) => ({
    id: item.href,
    label: item.label,
    icon: icons[item.icon],
    isSelected: item.href === active,
    onClick: () => router.push(item.href),
  }));
  return (
    <DropdownMenu
      button={{
        label: "Menu",
        isIconOnly: true,
        variant: "ghost",
        icon: <Glyph name="list" />,
      }}
      alignment="start"
      menuWidth={MOBILE_MENU_WIDTH}
      items={items}
    />
  );
}
