"use client";

import {
  Avatar,
  Badge,
  BrandHeading,
  DropdownMenu,
  TopNav,
  icons,
  useAppShellMobile,
} from "sid-ui";

import { AdminNav } from "./admin-nav";

import { signOutAction } from "@/lib/actions/auth";
import { BRAND } from "@/lib/config";
import { HOME_ROUTE } from "@/lib/routes";

const MENU_WIDTH = 260;
const TRIGGER_AVATAR = 24;

/** The console bar: brand, the page pills, and the signed-in admin's menu. */
export function AdminHeader({
  email,
  awaitingSupport,
}: {
  email: string;
  awaitingSupport: number;
}) {
  const { isMobile } = useAppShellMobile();
  return (
    <TopNav
      label={BRAND}
      heading={
        <BrandHeading
          product={BRAND}
          headingHref={HOME_ROUTE}
          headerEndContent={<Badge label="Support" variant="purple" />}
        />
      }
      centerContent={isMobile ? undefined : <AdminNav awaitingSupport={awaitingSupport} />}
      endContent={
        <DropdownMenu
          button={{
            label: email,
            isIconOnly: isMobile,
            variant: "ghost",
            icon: <Avatar name={email} size={TRIGGER_AVATAR} tooltip={false} />,
          }}
          hasChevron={!isMobile}
          alignment="end"
          menuWidth={MENU_WIDTH}
          items={[
            {
              id: "identity",
              label: email,
              description: "Signed in to the support console",
              icon: icons.user,
            },
            { type: "divider" },
            {
              id: "sign-out",
              label: "Sign out",
              icon: icons.signOut,
              onClick: () => void signOutAction(),
            },
          ]}
        />
      }
    />
  );
}
