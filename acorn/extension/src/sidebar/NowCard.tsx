import { RUN_OUTCOME } from "@acorn/shared/run-types";
import { describeRunFailure } from "@acorn/shared/user-messages";
import { Badge, Button, Card, Glyph, HStack, ProgressBar, Text, VStack } from "sid-ui";

import { AgentAsk } from "./AgentAsk";
import { AgentStopNotice } from "./AgentStopNotice";
import { GenerateProgressBar } from "./GenerateProgressBar";
import { MailSearchPanel } from "./MailSearchPanel";
import { RunCelebration } from "./RunCelebration";
import { RunCost } from "./RunCost";
import { RunTimer } from "./RunTimer";

import type { useTabSession } from "./use-tab-session";
import type { CustomUiProgress } from "../pipeline/custom-generate-progress";
import type { PipelineProgress } from "@acorn/shared/pipeline-types";
import type { RecommendedResumeRank } from "@acorn/shared/resume-library";

type TabSession = ReturnType<typeof useTabSession>;

export type NowAction = {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
};

type NowCardProps = {
  tabJob: TabSession["tabJob"];
  jobGenerate: TabSession["jobGenerates"][string] | null;
  progress: PipelineProgress;
  fillBusy: boolean;
  /** Recommend, fill, and advance until the application is done. */
  run: NowAction;
  /** Stops the Run working on this tab; null when none is. */
  stop: NowAction | null;
  /** Gives the person's answer to the question an agent Run waits on. */
  answerRun: (optionId: string) => void;
  /** Carries on from where the last run on this tab stopped; null when none did. */
  continueRun: NowAction | null;
};

/** What the card says about the active tab, and which generate run (if any) it shows. */
function describe({ tabJob, jobGenerate }: Pick<NowCardProps, "tabJob" | "jobGenerate">) {
  if (!tabJob) {
    return {
      title: "No job on this tab",
      subtitle: "Recommend a library résumé from this page, or fill without one.",
      status: null,
      run: null,
    };
  }
  const generating =
    jobGenerate?.generateStatus === "queued" || jobGenerate?.generateStatus === "running";
  const recommended = Boolean(jobGenerate?.recommendedResumeId);
  const generated = Boolean(jobGenerate?.generationId);
  const text = generating
    ? jobGenerate?.generateProgress?.label || "Generating…"
    : generated
      ? "Generated"
      : recommended
        ? "Recommended"
        : "";
  return {
    title: tabJob.title,
    subtitle: tabJob.company,
    status: text
      ? {
          text,
          ready: !generating && (generated || recommended),
          failed: false,
        }
      : null,
    run: generating ? (jobGenerate?.generateProgress ?? null) : null,
  };
}

/** Recommend's ranked Library résumés for the active tab's attached job. */
function recommendedTop({
  jobGenerate,
}: Pick<NowCardProps, "jobGenerate">): RecommendedResumeRank[] {
  return jobGenerate?.recommendedTop ?? [];
}

function RecommendTop({ top }: { top: RecommendedResumeRank[] }) {
  return (
    <VStack gap={1}>
      <Text type="supporting" weight="semibold">
        Top matches
      </Text>
      {top.map((row, i) => (
        <HStack key={row.resumeId} gap={2} align="center" justify="between">
          <Text type="supporting" maxLines={1}>
            {`${i + 1}. ${row.stack}`}
          </Text>
          <Badge
            variant={i === 0 ? "green" : "neutral"}
            label={`${Math.round(row.probability * 100)}%`}
          />
        </HStack>
      ))}
    </VStack>
  );
}

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
  const timer = run.startedAt ? <RunTimer startedAt={run.startedAt} endedAt={run.endedAt} /> : null;
  if (run.ask && run.endedAt == null) {
    return (
      <VStack gap={1}>
        {timer}
        <RunCost run={run} />
        <AgentAsk ask={run.ask} onAnswer={onAnswer} />
      </VStack>
    );
  }
  if (failure?.agentStop) {
    return (
      <VStack gap={1}>
        {timer}
        <RunCost run={run} />
        <AgentStopNotice failure={failure} />
      </VStack>
    );
  }
  if (failure) {
    const said = describeRunFailure(failure);
    return (
      <VStack gap={1}>
        {timer}
        <RunCost run={run} />
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
  const ready = run.report?.outcome === RUN_OUTCOME.readyToSubmit;
  const parts = [run.step ? `Step ${run.step}` : `Page ${Math.max(run.page, 1)}`];
  if (run.refills > 0) parts.push(`refill ${run.refills}/${run.maxRefills}`);
  return (
    <VStack gap={1}>
      {timer}
      <RunCost run={run} />
      {ready ? (
        <HStack gap={2} align="center">
          <Badge variant="green" label="Ready to submit" />
          <Text type="supporting">Every step is filled; review it and submit.</Text>
        </HStack>
      ) : null}
      <Text type="supporting">{parts.join(" · ")}</Text>
    </VStack>
  );
}

function RunProgress({ run }: { run: CustomUiProgress }) {
  return (
    <VStack gap={1}>
      <GenerateProgressBar progress={run} />
      <Text type="supporting">{run.label}</Text>
    </VStack>
  );
}

/** The active Chrome tab at the top of Jobs: which job it is, its résumé, any run in flight, and the Run actions. */
export function NowCard(props: NowCardProps) {
  const { progress, fillBusy, run: runAction, stop, answerRun, continueRun } = props;
  const { title, subtitle, status, run } = describe(props);
  const top = run ? [] : recommendedTop(props);

  return (
    <Card padding={4} className="acorn-now" elevation="low">
      <VStack gap={3}>
        <HStack gap={2} align="center" justify="between">
          <Text type="supporting" weight="semibold" color="accent">
            On this tab
          </Text>
          {status ? (
            <Badge
              variant={status.failed ? "error" : status.ready ? "green" : "neutral"}
              label={status.text}
            />
          ) : null}
        </HStack>
        <VStack gap={0}>
          <Text type="large" weight="semibold" maxLines={2}>
            {title}
          </Text>
          <Text type="supporting" maxLines={2}>
            {subtitle}
          </Text>
        </VStack>
        {run ? <RunProgress run={run} /> : null}
        {top.length ? <RecommendTop top={top} /> : null}
        {fillBusy ? <ProgressBar label={progress.message || "Working…"} isIndeterminate /> : null}
        <RunStatus progress={progress} onAnswer={answerRun} />
        {progress.run?.mail && progress.run.report?.outcome !== RUN_OUTCOME.completed ? (
          <MailSearchPanel search={progress.run.mail} />
        ) : null}
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
          {stop ? (
            <Button
              variant="destructive"
              icon={<Glyph name="close" />}
              label={stop.label}
              tooltip={stop.title}
              isDisabled={stop.disabled}
              width="100%"
              onClick={stop.onClick}
            />
          ) : null}
        </VStack>
      </VStack>
    </Card>
  );
}
