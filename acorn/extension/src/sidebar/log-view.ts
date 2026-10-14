import { summarizeLog, type LogRunSummary } from "../log-summary";
import { LOG_KIND, type LogKind, type TabLogEntry } from "../tab-log-session";

/** The Logs tab's views: which kinds of entry each shows. */
export const LOG_VIEW = {
  all: "all",
  problems: "problems",
  run: "run",
  ai: "ai",
  trees: "trees",
} as const;

export type LogView = (typeof LOG_VIEW)[keyof typeof LOG_VIEW];

export const VIEW_LABEL: Record<LogView, string> = {
  all: "All",
  problems: "Problems",
  run: "Run",
  ai: "AI",
  trees: "Trees",
};

const VIEW_KINDS: Record<Exclude<LogView, "all" | "problems">, LogKind[]> = {
  run: [LOG_KIND.decision, LOG_KIND.analysis, LOG_KIND.plan, LOG_KIND.event],
  ai: [LOG_KIND.api, LOG_KIND.aiRequest, LOG_KIND.aiResponse],
  trees: [LOG_KIND.dom, LOG_KIND.pureTree, LOG_KIND.metaTree],
};

export const KIND_LABEL: Record<LogKind, string> = {
  dom: "DOM",
  "pure-tree": "Compressed",
  "meta-tree": "Meta",
  analysis: "Analysis",
  "ai-request": "Request",
  "ai-response": "Response",
  plan: "Plan",
  event: "Event",
  api: "API",
  decision: "Decision",
  error: "Error",
};

/** Entries that went wrong or were refused: what a person reads first. */
export function isProblem(entry: TabLogEntry): boolean {
  return entry.level === "warn" || entry.level === "error" || entry.kind === LOG_KIND.error;
}

/** The entries a view and a search show; the search matches title and text, ignoring case. */
export function filterEntries(
  entries: readonly TabLogEntry[],
  view: LogView,
  query: string,
): TabLogEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (view === LOG_VIEW.problems && !isProblem(entry)) return false;
    if (view !== LOG_VIEW.all && view !== LOG_VIEW.problems) {
      if (!VIEW_KINDS[view].includes(entry.kind)) return false;
    }
    if (!needle) return true;
    return entry.title.toLowerCase().includes(needle) || entry.text.toLowerCase().includes(needle);
  });
}

export type LogGroup = {
  /** Undefined for the entries written before any run. */
  runId: string | undefined;
  /** When the group began, for the relative times inside it. */
  startedAt: number;
  summary: LogRunSummary | null;
  entries: TabLogEntry[];
};

/** The shown entries as one group per run, in the order the runs began. */
export function groupByRun(
  shown: readonly TabLogEntry[],
  all: readonly TabLogEntry[],
  version: string,
): LogGroup[] {
  const summaries = new Map(summarizeLog(all, version).runs.map((run) => [run.runId, run]));
  const groups = new Map<string | undefined, LogGroup>();
  for (const entry of shown) {
    let group = groups.get(entry.runId);
    if (!group) {
      const summary = entry.runId ? (summaries.get(entry.runId) ?? null) : null;
      group = {
        runId: entry.runId,
        startedAt: summary?.startedAt ?? entry.t,
        summary,
        entries: [],
      };
      groups.set(entry.runId, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** `+12.3 s` after the group began, `+2 m 5 s` past a minute. */
export function sinceLabel(t: number, startedAt: number): string {
  const seconds = Math.max(0, (t - startedAt) / 1000);
  if (seconds < 60) return `+${seconds.toFixed(1)} s`;
  return `+${Math.floor(seconds / 60)} m ${Math.round(seconds % 60)} s`;
}

/** A pretty-printed JSON text; anything else is shown as it is. */
export function prettyText(text: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
