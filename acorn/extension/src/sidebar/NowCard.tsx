import {
  RUN_MAP_PHASE,
  RUN_OUTCOME,
  RUN_STAGE,
  isRunMap,
  type RunMap,
} from "@acorn/shared/run-types";
import { READY_TO_SUBMIT, describeRunFailure } from "@acorn/shared/user-messages";
import { useMemo } from "react";
import {
  Badge,
  Banner,
  Button,
  Card,
  Glyph,
  HStack,
  ProgressBar,
  StatusDot,
  Text,
  VStack,
} from "sid-ui";

import { AgentAsk } from "./AgentAsk";
import { AgentStopNotice } from "./AgentStopNotice";
import { MailSearchPanel } from "./MailSearchPanel";
import { actionLine, questionTally, questionsOf, type RunQuestion } from "./run-questions";
import { EmptyBoard, RunBoard } from "./RunBoard";
import { RunCelebration } from "./RunCelebration";
import { RunFooter } from "./RunFooter";
import { showOnPage } from "./show-on-page";

import type { PipelineProgress } from "@acorn/shared/pipeline-types";

export type NowAction = {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
};

type NowCardProps = {
  progress: PipelineProgress;
  fillBusy: boolean;
  /** The active Chrome tab, which the card's run and its page belong to. */
  tabId: number | null;
  /** Recommend, fill, and advance until the application is done. */
  run: NowAction;
  /** Stops the Run working on this tab; null when none is. */
  stop: NowAction | null;
  /** Gives the person's answer to the question an agent Run waits on. */
  answerRun: (optionId: string) => void;
  /** Carries on from where the last run on this tab stopped; null when none did. */
  continueRun: NowAction | null;
};

/** The card's line while the run reads the person's Gmail for a code or link the site sent. */
const MAIL_LINE = "Reading your Gmail";

/**
 * What the run is doing, at the top of the card: the agent's own words while it works, one bar for the
 * questions answered of those that count, and a line saying what it does this moment beside the count.
 */
function RunHeadline({
  progress,
  map,
  questions,
  working,
}: {
  progress: PipelineProgress;
  map: RunMap | null;
  questions: RunQuestion[];
  working: boolean;
}) {
  const tally = questionTally(questions);
  const reading = progress.run?.stage === RUN_STAGE.verifying;
  const line = reading ? MAIL_LINE : map ? actionLine(map, questions) : progress.message;
  // Waiting on the person, not reading their mail for them: the dot says it is their turn.
  const theirTurn = !reading && map?.phase === RUN_MAP_PHASE.waiting;
  const count = tally.total > 0 ? `${tally.answered} of ${tally.total} answered` : "";
  const complete = tally.total > 0 && tally.answered === tally.total;
  if (!working && !count) return null;
  return (
    <VStack gap={2}>
      {working && map && progress.message ? (
        <Text type="body" weight="medium" maxLines={3}>
          {progress.message}
        </Text>
      ) : null}
      <ProgressBar
        label={count || line || "Working"}
        isLabelHidden
        value={tally.answered}
        max={Math.max(1, tally.total)}
        isIndeterminate={working && tally.total === 0}
        variant={!working && complete ? "success" : "accent"}
      />
      <HStack gap={2} align="center" justify={working ? "between" : "start"}>
        {working ? (
          <HStack gap={1.5} align="center" className="acorn-run-line">
            {line ? (
              <StatusDot variant={theirTurn ? "warning" : "accent"} label={line} isPulsing />
            ) : null}
            <Text type="supporting" maxLines={1}>
              {line}
            </Text>
          </HStack>
        ) : null}
        {count ? (
          <Text type="supporting" weight="semibold" hasTabularNumbers className="acorn-run-count">
            {count}
          </Text>
        ) : null}
      </HStack>
    </VStack>
  );
}

/** How the run stands beyond its board: the question it waits on, why it stopped, or that it is done. */
function RunStatus({
  progress,
  onAnswer,
}: {
  progress: PipelineProgress;
  onAnswer: (optionId: string) => void;
}) {
  const run = progress.run;
  const failure = run?.report?.failure;
  if (!run) return null;
  if (run.ask && run.endedAt == null) return <AgentAsk ask={run.ask} onAnswer={onAnswer} />;
  if (failure?.agentStop) return <AgentStopNotice failure={failure} />;
  if (failure) {
    const said = describeRunFailure(failure);
    return (
      <VStack gap={1}>
        <HStack gap={2} align="center">
          <Badge variant="error" label="Run stopped" />
        </HStack>
        <Text type="supporting" weight="semibold">
          {said.title}
        </Text>
        {said.detail ? <Text type="supporting">{said.detail}</Text> : null}
        {said.technical && said.technical !== said.title ? (
          <details className="run-failure-details">
            <summary>Details</summary>
            <Text type="supporting">{said.technical}</Text>
          </details>
        ) : null}
      </VStack>
    );
  }
  if (run.report?.outcome === RUN_OUTCOME.completed) {
    return <RunCelebration key={run.runId} run={run} />;
  }
  if (run.report?.outcome === RUN_OUTCOME.readyToSubmit) {
    // Neither sent nor failed: the person reviews the page and sends it themselves.
    return (
      <Banner
        status="info"
        icon={<Glyph name="eye" />}
        title={READY_TO_SUBMIT.title}
        description={READY_TO_SUBMIT.detail}
      />
    );
  }
  return null;
}

/**
 * The active Chrome tab at the top of Jobs: the run on it and the Run actions. While a run works, the card
 * says what it does, maps the page beside the list of its questions (`RunBoard`), shows what the model last
 * saw, and keeps Stop in its header; the run's clock and cost sit at its foot. A map another build wrote
 * is not drawn (`isRunMap`).
 */
export function NowCard(props: NowCardProps) {
  const { progress, fillBusy, tabId, run: runAction, stop, answerRun, continueRun } = props;
  const run = progress.run;
  const map = run?.map && isRunMap(run.map) ? run.map : null;
  const questions = useMemo(() => (map ? questionsOf(map) : []), [map]);
  const completed = run?.report?.outcome === RUN_OUTCOME.completed;

  return (
    <Card padding={4} className="acorn-now" elevation="low">
      <VStack gap={3}>
        <HStack gap={2} align="center" justify="between">
          <Text type="supporting" weight="semibold" color="accent">
            On this tab
          </Text>
          {stop ? (
            <Button
              variant="destructive"
              size="sm"
              icon={<Glyph name="close" />}
              label={stop.label}
              tooltip={stop.title}
              isDisabled={stop.disabled}
              onClick={stop.onClick}
            />
          ) : null}
        </HStack>
        {fillBusy || run ? (
          <RunHeadline progress={progress} map={map} questions={questions} working={fillBusy} />
        ) : null}
        <RunStatus progress={progress} onAnswer={answerRun} />
        {run?.mail && !completed ? <MailSearchPanel search={run.mail} /> : null}
        {map && run ? (
          <RunBoard
            map={map}
            questions={questions}
            runId={run.runId}
            tabId={tabId}
            working={fillBusy}
            onShow={(target) => {
              if (tabId != null) void showOnPage(tabId, target);
            }}
          />
        ) : !fillBusy ? (
          <EmptyBoard />
        ) : null}
        {run?.startedAt && !completed ? <RunFooter run={run} /> : null}
        {!fillBusy ? (
          <VStack gap={2}>
            {continueRun ? (
              <Button
                variant="primary"
                icon={<Glyph name="play" />}
                label={continueRun.label}
                tooltip={continueRun.title}
                isDisabled={continueRun.disabled}
                width="100%"
                onClick={continueRun.onClick}
              />
            ) : null}
            <Button
              variant={continueRun ? "secondary" : "primary"}
              icon={<Glyph name="play" />}
              label={runAction.label}
              tooltip={runAction.title}
              isDisabled={runAction.disabled}
              width="100%"
              onClick={runAction.onClick}
            />
          </VStack>
        ) : null}
      </VStack>
    </Card>
  );
}
