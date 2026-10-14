"use client";

import { useRouter } from "next/navigation";
import { Avatar, DropdownMenu, icons, useAppShellMobile, type DropdownMenuOption } from "sid-ui";
import { signOut } from "@/lib/auth/actions";
import type { AcornAccount } from "@/lib/auth/session";

const MENU_WIDTH = 280;
const TRIGGER_AVATAR = 24;
const HEADER_AVATAR = 32;

export function AccountMenu({ account }: { account: AcornAccount }) {
  const router = useRouter();
  const { isMobile } = useAppShellMobile();

  const items: DropdownMenuOption[] = [
    {
      id: "identity",
      label: account.name,
      description: account.email,
      icon: <Avatar name={account.name} size={HEADER_AVATAR} tooltip={false} />,
    },
    { type: "divider" },
    {
      id: "sign-out",
      label: "Sign out",
      icon: icons.signOut,
      onClick: () => {
        void signOut().then(() => router.refresh());
      },
    },
  ];

  return (
    <DropdownMenu
      button={{
        label: account.name.split(" ")[0] || account.name,
        isIconOnly: isMobile,
        variant: "ghost",
        icon: <Avatar name={account.name} size={TRIGGER_AVATAR} tooltip={false} />,
      }}
      hasChevron={!isMobile}
      alignment="end"
      menuWidth={MENU_WIDTH}
      items={items}
    />
  );
}
