import type { useResumePreview } from "./use-resume-preview";
import type { useSidebarAuth } from "./use-sidebar-auth";
import type { useTabSession } from "./use-tab-session";
import type { countBusyWorkers } from "../acorn-face/director";

/** What the sidebar hooks return, so panels take exactly the values SidebarApp holds. */
export type TabSession = ReturnType<typeof useTabSession>;
export type ResumePreview = ReturnType<typeof useResumePreview>;
export type SidebarAuth = ReturnType<typeof useSidebarAuth>;
export type BusyCounts = ReturnType<typeof countBusyWorkers>;
