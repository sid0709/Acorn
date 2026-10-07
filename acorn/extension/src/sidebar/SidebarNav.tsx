import { useEffect } from "react";
import { PillNav } from "sid-ui";

export type AcornMainTab = "fill" | "qa" | "custom" | "support";

const TABS: AcornMainTab[] = ["fill", "qa", "custom", "support"];

function tabFromHash(): AcornMainTab | null {
  const hash = window.location.hash.slice(1);
  return (TABS as string[]).includes(hash) ? (hash as AcornMainTab) : null;
}

type SidebarNavProps = {
  value: AcornMainTab;
  onChange: (next: AcornMainTab) => void;
  /** Fill jobs and Custom tabs with work in flight. */
  busyJobs: number;
  rememberedTabs: number;
  /** Reports with a support reply not yet read. */
  unreadSupport: number;
};

/**
 * Jobs / Ask / Tabs / Support as a PillNav. The pills are hash links, so the side panel
 * needs no router: the hash is the selected tab.
 */
export function SidebarNav({
  value,
  onChange,
  busyJobs,
  rememberedTabs,
  unreadSupport,
}: SidebarNavProps) {
  useEffect(() => {
    const sync = () => {
      const next = tabFromHash();
      if (next) onChange(next);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [onChange]);

  return (
    <PillNav
      label="Acorn"
      activeHref={`#${value}`}
      items={[
        { href: "#fill", label: "Jobs", icon: "list", count: busyJobs },
        { href: "#qa", label: "Ask", icon: "sparkle" },
        { href: "#custom", label: "Tabs", icon: "pin", count: rememberedTabs },
        { href: "#support", label: "Support", icon: "chat", count: unreadSupport },
      ]}
    />
  );
}
