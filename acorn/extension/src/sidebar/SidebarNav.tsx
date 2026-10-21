import { useEffect } from "react";
import { PillNav } from "sid-ui";

export type AcornMainTab = "fill" | "agent" | "support" | "logs";

const NAV_TABS: AcornMainTab[] = ["fill", "agent", "support", "logs"];

function tabFromHash(): AcornMainTab | null {
  const hash = window.location.hash.slice(1);
  return (NAV_TABS as string[]).includes(hash) ? (hash as AcornMainTab) : null;
}

type SidebarNavProps = {
  value: AcornMainTab;
  onChange: (next: AcornMainTab) => void;
  /** Fill jobs with work in flight. */
  busyJobs: number;
  /** Queued jobs the Agent still has to do (waiting, working, or blocked). */
  agentOpen: number;
  /** Reports with a support reply not yet read. */
  unreadSupport: number;
};

/**
 * Jobs / Agent / Support / Logs as a PillNav. The pills are hash links, so the side panel needs no
 * router: the hash is the selected tab.
 */
export function SidebarNav({
  value,
  onChange,
  busyJobs,
  agentOpen,
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
    <div className="acorn-pill-nav">
      <PillNav
        label="Acorn"
        activeHref={`#${value}`}
        items={[
          { href: "#fill", label: "Jobs", icon: "list", count: busyJobs },
          { href: "#agent", label: "Agent", icon: "sparkle", count: agentOpen },
          { href: "#support", label: "Support", icon: "chat", count: unreadSupport },
          { href: "#logs", label: "Logs", icon: "list" },
        ]}
      />
    </div>
  );
}
