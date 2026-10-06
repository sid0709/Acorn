import type { AiUsageSummary } from "./ai-usage";
import type { ResumeGeneratedContent, ResumeIdentity } from "./resume-content";

export type ResumeHistorySearchIn = "all" | "jd" | "resume";
export type ResumeHistoryStatus = "all" | "completed" | "failed" | "running" | "queued";
export type ResumeHistorySort = "newest" | "oldest" | "cost-desc" | "cost-asc" | "tokens-desc";

export const RESUME_HISTORY_PER_PAGE = 15;
export const RESUME_HISTORY_SEARCH_DEBOUNCE_MS = 350;

export const RESUME_HISTORY_SORTS: { id: ResumeHistorySort; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "cost-desc", label: "Highest cost" },
  { id: "cost-asc", label: "Lowest cost" },
  { id: "tokens-desc", label: "Most tokens" },
];

export type ResumeHistoryQuery = {
  search?: string;
  searchIn?: ResumeHistorySearchIn;
  status?: ResumeHistoryStatus;
  model?: string;
  provider?: string;
  templateId?: string;
  from?: string;
  to?: string;
  sort?: ResumeHistorySort;
  limit?: number;
  offset?: number;
  includeFacets?: boolean;
};

export type ResumeHistoryRun = {
  id: string;
  status: string;
  provider: string;
  model: string;
  jobDescription: string;
  techStack: string;
  usage: AiUsageSummary | null;
  startedAt: string;
  finishedAt: string | null;
  templateId: string;
  sections?: Record<string, unknown>;
  identity?: ResumeIdentity | null;
  content?: ResumeGeneratedContent | null;
  error: string | null;
};

export type ResumeHistoryFacets = {
  models: string[];
  providers: string[];
  templates: string[];
  statusCounts: { completed: number; failed: number };
  stats: { completed: number; totalTokens: number; totalCost: number };
};

export type ResumeHistoryPage = {
  success: true;
  runs: ResumeHistoryRun[];
  total: number;
  limit: number;
  offset: number;
  facets?: ResumeHistoryFacets;
};

export function jdHeadline(jd: string, max = 90): string {
  const line = (jd || "").trim().split("\n").find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
