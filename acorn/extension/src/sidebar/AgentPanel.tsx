import { RUN_MAP_PHASE } from "@acorn/shared/run-types";
import { useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Glyph,
  HStack,
  IconButton,
  ProgressBar,
  Stack,
  StackItem,
  StatusDot,
  Switch,
  Text,
  TextArea,
} from "sid-ui";

import { QUEUE_MAX_ITEMS, linkLabel, parseJobLinks } from "../agent-queue/links";
import {
  QUEUE_ITEM,
  QUEUE_MODE,
  isFinished,
  tally,
  type QueueItem,
  type QueueItemStatus,
} from "../agent-queue/model";

import { pushAcornNotice } from "./acorn-notice";

import type { AcornMainTab } from "./SidebarNav";
import type { useAgentQueue } from "./use-agent-queue";
import type { PipelineProgress } from "@acorn/shared/pipeline-types";
import type { StatusDotVariant } from "sid-ui";

type AgentQueue = ReturnType<typeof useAgentQueue>;

const PLACEHOLDER = "https://company.com/jobs/123\nhttps://boards.example.com/role | Title";

/** How each status of a job is told apart in the list. */
const STATUS_LOOK: Record<QueueItemStatus, { label: string; dot: StatusDotVariant }> = {
  queued: { label: "Waiting", dot: "neutral" },
  opening: { label: "Opening", dot: "accent" },
  running: { label: "Working", dot: "accent" },
  blocked: { label: "Needs you", dot: "warning" },
  done: { label: "Sent", dot: "success" },
  skipped: { label: "Skipped", dot: "neutral" },
};

/** The line under a job: the Run's own words while it works, else why it stopped or what it did. */
function itemLine(item: QueueItem, live: PipelineProgress | undefined): string {
  if (item.status === QUEUE_ITEM.running && live?.message) {
    return live.run?.map?.phase === RUN_MAP_PHASE.waiting
      ? "Waiting for you on the page"
      : live.message;
  }
  return item.note ?? STATUS_LOOK[item.status].label;
}

function QueueRow({
  item,
  live,
  onSkip,
  onRemove,
}: {
  item: QueueItem;
  live: PipelineProgress | undefined;
  onSkip: () => void;
  onRemove: () => void;
}) {
  const look = STATUS_LOOK[item.status];
  const waiting =
    item.status === QUEUE_ITEM.running && live?.run?.map?.phase === RUN_MAP_PHASE.waiting;
  const finished = isFinished(item);
  return (
    <Card padding={3} elevation="none">
      <HStack gap={2} align="center">
        <StatusDot
          variant={waiting ? "warning" : look.dot}
          label={look.label}
          isPulsing={item.status === QUEUE_ITEM.running || item.status === QUEUE_ITEM.opening}
        />
        <StackItem size="fill">
          <Stack gap={0}>
            <Text weight="semibold" maxLines={1}>
              {linkLabel(item.url)}
            </Text>
            <Text type="supporting" maxLines={2}>
              {itemLine(item, live)}
            </Text>
          </Stack>
        </StackItem>
        {item.tabId != null && !finished ? (
          <IconButton
            label="Show its tab"
            icon={<Glyph name="eye" />}
            variant="ghost"
            size="sm"
            onClick={() => void chrome.tabs.update(item.tabId!, { active: true }).catch(() => {})}
          />
        ) : null}
        {finished || item.status === QUEUE_ITEM.queued ? (
          <IconButton
            label="Remove from the queue"
            icon={<Glyph name="close" />}
            variant="ghost"
            size="sm"
            onClick={onRemove}
          />
        ) : (
          <IconButton
            label="Skip this job"
            icon={<Glyph name="arrowRight" />}
            variant="ghost"
            size="sm"
            onClick={onSkip}
          />
        )}
      </HStack>
    </Card>
  );
}

/**
 * The Agent tab: paste job links, press Run, and the queue opens them one at a time and runs each
 * as the Jobs tab would, without a click. A job that needs the person pauses the queue until they
 * have dealt with it and press Continue.
 */
export function AgentPanel({
  mainTab,
  agent,
  pipelines,
}: {
  mainTab: AcornMainTab;
  agent: AgentQueue;
  pipelines: Record<string, PipelineProgress>;
}) {
  const { queue } = agent;
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const counts = tally(queue);
  const found = parseJobLinks(
    draft,
    queue.items.map((item) => item.url),
  );
  const blocked = queue.items.find((item) => item.status === QUEUE_ITEM.blocked);
  const running = queue.mode === QUEUE_MODE.running;
  const worked = counts.total - counts.skipped;
  const finishedAll = counts.total > 0 && counts.open === 0;

  const add = async () => {
    setAdding(true);
    try {
      const reply = await agent.add(draft);
      if (!reply.ok) {
        pushAcornNotice({ kind: "error", title: "Couldn’t add the links", detail: reply.error });
        return;
      }
      setDraft("");
      const skipped = (reply.duplicates ?? 0) + (reply.invalid ?? 0) + (reply.overflow ?? 0);
      pushAcornNotice({
        kind: "success",
        title: `${reply.added ?? 0} job${reply.added === 1 ? "" : "s"} queued`,
        detail: skipped
          ? `${skipped} left out (repeats, not links, or the queue is full).`
          : undefined,
      });
    } finally {
      setAdding(false);
    }
  };

  const act = async (run: () => Promise<{ ok?: boolean; error?: string }>) => {
    const reply = await run();
    if (!reply.ok && reply.error) {
      pushAcornNotice({ kind: "error", title: "Agent", detail: reply.error });
    }
  };

  return (
    <section
      id="acorn-panel-agent"
      className="acorn-panel"
      aria-label="Agent"
      hidden={mainTab !== "agent"}
    >
      <Card padding={4} elevation="low" className="acorn-now">
        <Stack gap={3}>
          <HStack gap={2} align="center" justify="between">
            <Text type="supporting" weight="semibold" color="accent">
              Job links
            </Text>
            {counts.total > 0 ? (
              <Badge
                variant={
                  blocked ? "warning" : running ? "blue" : finishedAll ? "success" : "neutral"
                }
                label={
                  blocked
                    ? "Needs you"
                    : running
                      ? `Working · ${counts.done} of ${worked}`
                      : finishedAll
                        ? "All done"
                        : "Ready"
                }
              />
            ) : null}
          </HStack>
          <TextArea
            label="Job links"
            isLabelHidden
            value={draft}
            onChange={setDraft}
            rows={5}
            placeholder={PLACEHOLDER}
            description="One link per line. Anything after the link’s first space is ignored."
          />
          <HStack gap={2} align="center" justify="between">
            <Text type="supporting" maxLines={2}>
              {draft.trim()
                ? [
                    `${found.links.length} new link${found.links.length === 1 ? "" : "s"}`,
                    found.duplicates ? `${found.duplicates} repeated` : "",
                    found.invalid ? `${found.invalid} not a link` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : `Holds up to ${QUEUE_MAX_ITEMS} jobs`}
            </Text>
            <Button
              label={adding ? "Adding…" : "Add to queue"}
              variant="secondary"
              size="sm"
              icon={<Glyph name="plus" />}
              isDisabled={adding || found.links.length === 0}
              onClick={() => void add()}
            />
          </HStack>
        </Stack>
      </Card>

      {counts.total === 0 ? (
        <EmptyState
          isCompact
          icon={<Glyph name="sparkle" />}
          title="Nothing queued"
          description="Paste links above. The Agent opens each one in a new tab and applies, one after another."
        />
      ) : (
        <Stack gap={3}>
          {blocked ? (
            <Banner
              status="warning"
              title="The Agent is waiting for you"
              description={`${linkLabel(blocked.url)}: ${blocked.note ?? "it needs you."} Deal with it on the tab, then press Continue.`}
            />
          ) : finishedAll ? (
            <Banner
              status="success"
              title="The queue is done"
              description={`${counts.done} application${counts.done === 1 ? "" : "s"} sent${counts.skipped ? `, ${counts.skipped} skipped` : ""}.`}
            />
          ) : null}

          <ProgressBar
            label="Jobs done"
            isLabelHidden
            value={counts.done}
            max={Math.max(1, worked)}
            hasValueLabel
          />

          <HStack gap={2}>
            {running ? (
              <Button
                label="Pause"
                variant="secondary"
                icon={<Glyph name="pause" />}
                onClick={() => void act(agent.pause)}
              />
            ) : (
              <Button
                label={blocked ? "Continue" : "Run agent"}
                variant="primary"
                icon={<Glyph name="play" />}
                isDisabled={counts.open === 0}
                onClick={() => void act(agent.start)}
              />
            )}
            {blocked ? (
              <Button
                label="Skip this job"
                variant="secondary"
                onClick={() => void act(() => agent.skip(blocked.id))}
              />
            ) : null}
          </HStack>

          <Stack gap={2}>
            {queue.items.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                live={item.tabId != null ? pipelines[String(item.tabId)] : undefined}
                onSkip={() => void agent.skip(item.id)}
                onRemove={() => void agent.remove(item.id)}
              />
            ))}
          </Stack>

          <HStack gap={2} align="center" justify="between">
            <Switch
              label="Close a job’s tab once it is sent"
              value={queue.closeDone}
              onChange={(value) => void agent.setCloseDone(value)}
            />
            {counts.done + counts.skipped > 0 ? (
              <Button
                label="Clear finished"
                variant="ghost"
                size="sm"
                onClick={() => void agent.clearFinished()}
              />
            ) : null}
          </HStack>
        </Stack>
      )}
    </section>
  );
}
