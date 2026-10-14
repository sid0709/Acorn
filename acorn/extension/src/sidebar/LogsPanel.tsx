import { useMemo, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Glyph,
  HStack,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Text,
  TextInput,
} from "sid-ui";

import { LOG_LEVEL, type TabLogEntry } from "../tab-log-session";

import {
  KIND_LABEL,
  LOG_VIEW,
  VIEW_LABEL,
  filterEntries,
  groupByRun,
  isProblem,
  prettyText,
  sinceLabel,
  type LogGroup,
  type LogView,
} from "./log-view";
import { downloadLogZip } from "./log-zip";
import { useTabLog } from "./use-tab-log";

import type { AcornMainTab } from "./SidebarNav";

const VERSION = import.meta.env.VITE_ACORN_VERSION ?? "";

function timeOf(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour12: false });
}

function levelVariant(entry: TabLogEntry): "neutral" | "warning" | "error" {
  if (entry.level === LOG_LEVEL.error || entry.kind === "error") return "error";
  return entry.level === LOG_LEVEL.warn ? "warning" : "neutral";
}

/** One entry: a collapsed row, and the code block only once it is opened. */
function LogEntryRow({ entry, startedAt }: { entry: TabLogEntry; startedAt: number }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="log-entry" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="log-entry-summary">
        <Text size="sm" color="secondary">
          {sinceLabel(entry.t, startedAt)}
        </Text>
        <Badge variant={levelVariant(entry)} label={KIND_LABEL[entry.kind]} />
        <span className="log-entry-title">{entry.title}</span>
        {entry.ms != null ? (
          <Text size="sm" color="secondary">
            {entry.ms} ms
          </Text>
        ) : null}
      </summary>
      {open ? (
        <>
          <HStack gap={2} justify="between" align="center">
            <Text size="sm" color="secondary">
              {timeOf(entry.t)}
              {entry.step != null ? ` · step ${entry.step}` : ""}
              {entry.page != null && entry.page > 0 ? ` · page ${entry.page}` : ""}
            </Text>
            <Button
              variant="ghost"
              size="sm"
              label="Copy"
              onClick={() => void navigator.clipboard.writeText(entry.text)}
            />
          </HStack>
          <pre className="log-code">
            <code>{prettyText(entry.text) || "(empty)"}</code>
          </pre>
        </>
      ) : null}
    </details>
  );
}

/** How a run ended, in a few words, for its heading. */
function runHeading(group: LogGroup): string {
  if (!group.runId) return "Before any run";
  const run = group.summary;
  if (!run) return `Run ${group.runId}`;
  const how = run.outcome === "unfinished" ? "not finished" : run.outcome;
  const seconds = run.seconds != null ? ` · ${Math.round(run.seconds)} s` : "";
  const reason = run.reason ? ` (${run.reason})` : "";
  return `Run ${group.runId} · ${how}${reason}${seconds}`;
}

function LogRunGroup({ group }: { group: LogGroup }) {
  const problems = group.entries.filter(isProblem).length;
  return (
    <details className="log-run" open={group.entries.length < 200}>
      <summary className="log-run-summary">
        <span className="log-entry-title">{runHeading(group)}</span>
        {problems > 0 ? <Badge variant="warning" label={`${problems} problems`} /> : null}
        <Badge variant="neutral" label={`${group.entries.length}`} />
      </summary>
      <Stack gap={2}>
        {group.entries.map((entry) => (
          <LogEntryRow key={entry.id} entry={entry} startedAt={group.startedAt} />
        ))}
      </Stack>
    </details>
  );
}

/**
 * The Logs tab: everything the run did on this tab, grouped by run, with each backend
 * call (what was sent and answered, and how long it took), the decisions the run took
 * and why, the trees, the plan and each step. It stays in the browser; it goes to
 * Acorn only when a support report is submitted.
 */
export function LogsPanel({ mainTab, tabId }: { mainTab: AcornMainTab; tabId: number | null }) {
  const { entries, clear, lost } = useTabLog(tabId);
  const [view, setView] = useState<LogView>(LOG_VIEW.all);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => filterEntries(entries, view, query), [entries, view, query]);
  const groups = useMemo(() => groupByRun(shown, entries, VERSION), [shown, entries]);

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
      {lost > 0 ? (
        <Banner
          status="warning"
          title="Some log entries could not be saved"
          description={`${lost} entries were lost because the browser refused the write. The rest of the log is complete.`}
        />
      ) : null}
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
            isDisabled={entries.length === 0}
            onClick={() => void downloadLogZip(entries, tabId)}
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
      <TextInput
        label="Search the log"
        value={query}
        onChange={setQuery}
        placeholder="Search titles and contents"
      />
      {shown.length === 0 ? (
        <EmptyState
          isCompact
          icon={<Glyph name="info" />}
          title={entries.length === 0 ? "No logs yet" : "Nothing matches"}
          description={
            entries.length === 0
              ? "Fill or Run on this tab. Every step, backend call and decision shows here."
              : "Try another view or search."
          }
        />
      ) : (
        <Stack gap={3}>
          {groups.map((group) => (
            <LogRunGroup key={group.runId ?? "before-any-run"} group={group} />
          ))}
        </Stack>
      )}
    </section>
  );
}
