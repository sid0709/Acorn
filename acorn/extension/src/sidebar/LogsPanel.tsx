import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Glyph,
  HStack,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Text,
} from "sid-ui";

import { LOG_KIND, type LogKind, type TabLogEntry } from "../tab-log-session";

import { downloadLogZip } from "./log-zip";
import { useTabLog } from "./use-tab-log";

import type { AcornMainTab } from "./SidebarNav";

const LOG_VIEW = {
  all: "all",
  trees: "trees",
  ai: "ai",
  run: "run",
} as const;

type LogView = (typeof LOG_VIEW)[keyof typeof LOG_VIEW];

const VIEW_LABEL: Record<LogView, string> = {
  all: "All",
  trees: "Trees",
  ai: "AI",
  run: "Run",
};

const VIEW_KINDS: Record<Exclude<LogView, "all">, LogKind[]> = {
  trees: [LOG_KIND.dom, LOG_KIND.pureTree, LOG_KIND.metaTree],
  ai: [LOG_KIND.aiRequest, LOG_KIND.aiResponse],
  run: [LOG_KIND.analysis, LOG_KIND.plan, LOG_KIND.event],
};

const KIND_LABEL: Record<LogKind, string> = {
  dom: "DOM",
  "pure-tree": "Compressed",
  "meta-tree": "Meta",
  analysis: "Analysis",
  "ai-request": "Request",
  "ai-response": "Response",
  plan: "Plan",
  event: "Event",
};

function timeOf(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour12: false });
}

/** One entry: a collapsed row, and the code block only once it is opened. */
function LogEntryRow({ entry }: { entry: TabLogEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="log-entry" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="log-entry-summary">
        <Text size="sm" color="secondary">
          {timeOf(entry.t)}
        </Text>
        <Badge variant="neutral" label={KIND_LABEL[entry.kind]} />
        <span className="log-entry-title">{entry.title}</span>
      </summary>
      {open ? (
        <>
          <HStack gap={2} justify="end">
            <Button
              variant="ghost"
              size="sm"
              label="Copy"
              onClick={() => void navigator.clipboard.writeText(entry.text)}
            />
          </HStack>
          <pre className="log-code">
            <code>{entry.text || "(empty)"}</code>
          </pre>
        </>
      ) : null}
    </details>
  );
}

/**
 * The Logs tab: everything the pipeline did on this tab, as code blocks in order. The
 * compressed tree, the meta tree, the analysis, the model request and response, the
 * action plan, and each step.
 */
export function LogsPanel({ mainTab, tabId }: { mainTab: AcornMainTab; tabId: number | null }) {
  const { entries, clear } = useTabLog(tabId);
  const [view, setView] = useState<LogView>(LOG_VIEW.all);

  const shown = useMemo(() => {
    if (view === LOG_VIEW.all) return entries;
    const kinds = VIEW_KINDS[view];
    return entries.filter((entry) => kinds.includes(entry.kind));
  }, [entries, view]);

  const copyAll = () =>
    navigator.clipboard.writeText(
      shown.map((entry) => `### ${timeOf(entry.t)} ${entry.title}\n${entry.text}`).join("\n\n"),
    );

  return (
    <section
      id="acorn-panel-logs"
      className="acorn-panel"
      aria-label="Logs"
      hidden={mainTab !== "logs"}
    >
      <HStack gap={2} justify="between" align="center">
        <Badge variant="neutral" label={`${shown.length} entries`} />
        <HStack gap={2}>
          <Button
            variant="secondary"
            size="sm"
            label="Copy all"
            isDisabled={shown.length === 0}
            onClick={() => void copyAll()}
          />
          <Button
            variant="secondary"
            size="sm"
            label="Download"
            isDisabled={shown.length === 0}
            onClick={() => downloadLogZip(shown, tabId)}
          />
          <Button
            variant="ghost"
            size="sm"
            label="Clear"
            isDisabled={entries.length === 0}
            onClick={clear}
          />
        </HStack>
      </HStack>
      <SegmentedControl
        label="Which logs"
        value={view}
        onChange={(value) => setView(value as LogView)}
        size="sm"
        layout="fill"
      >
        {Object.values(LOG_VIEW).map((value) => (
          <SegmentedControlItem key={value} value={value} label={VIEW_LABEL[value]} />
        ))}
      </SegmentedControl>
      {shown.length === 0 ? (
        <EmptyState
          isCompact
          icon={<Glyph name="info" />}
          title="No logs yet"
          description="Fill or Run on this tab. The trees, the AI request and response, the plan and each step show here."
        />
      ) : (
        <Stack gap={2}>
          {shown.map((entry) => (
            <LogEntryRow key={entry.id} entry={entry} />
          ))}
        </Stack>
      )}
    </section>
  );
}
