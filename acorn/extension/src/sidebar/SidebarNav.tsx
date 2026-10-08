import { useEffect } from "react";
import { PillNav } from "sid-ui";

export type AcornMainTab = "fill" | "qa" | "custom" | "support";

const NAV_TABS: AcornMainTab[] = ["fill", "qa", "support"];

function tabFromHash(): AcornMainTab | null {
  const hash = window.location.hash.slice(1);
  if (hash === "custom") return "fill";
  return (NAV_TABS as string[]).includes(hash) ? (hash as AcornMainTab) : null;
}

type SidebarNavProps = {
  value: AcornMainTab;
  onChange: (next: AcornMainTab) => void;
  /** Fill jobs with work in flight. */
  busyJobs: number;
  /** Reports with a support reply not yet read. */
  unreadSupport: number;
};

/**
 * Jobs / Ask / Support as a PillNav. The pills are hash links, so the side panel needs no
 * router: the hash is the selected tab.
 */
export function SidebarNav({ value, onChange, busyJobs, unreadSupport }: SidebarNavProps) {
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
    <div className="acorn-pill-nav">
      <PillNav
        label="Acorn"
        activeHref={`#${value}`}
        items={[
          { href: "#fill", label: "Jobs", icon: "list", count: busyJobs },
          { href: "#qa", label: "Ask", icon: "sparkle" },
          { href: "#support", label: "Support", icon: "chat", count: unreadSupport },
        ]}
      />
    </div>
  );
}
