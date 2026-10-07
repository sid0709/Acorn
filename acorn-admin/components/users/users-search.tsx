"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TextInput, icons } from "sid-ui";

/** How long typing pauses before the list searches. */
const SEARCH_DELAY_MS = 300;

/** Name or email search, kept in the URL as ?q. */
export function UsersSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (value === initial) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value, initial, params, pathname, router]);

  return (
    <TextInput
      label="Search users"
      isLabelHidden
      placeholder="Search by name or email"
      startIcon={icons.search}
      value={value}
      onChange={setValue}
      hasClear
    />
  );
}
