import { Badge, Button, Card, Glyph, HStack, ProgressBar, Text, VStack } from "sid-ui";
import type { PipelineProgress } from "@acorn/shared/pipeline-types";
import type { RecommendedResumeRank } from "@acorn/shared/resume-library";
import type { CustomUiProgress } from "../pipeline/custom-generate-progress";
import { customTabResumeLine, hostOf } from "./custom-tab-resume";
import { JOBS_NOW_CARD_RUN_ONLY } from "./sidebar-work-state";
import { GenerateProgressBar } from "./GenerateProgressBar";
import type { AcornMainTab } from "./SidebarNav";
import type { useTabSession } from "./use-tab-session";

type TabSession = ReturnType<typeof useTabSession>;

export type NowAction = {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
};

type NowCardProps = {
  mainTab: Exclude<AcornMainTab, "qa">;
  tabJob: TabSession["tabJob"];
  jobGenerate: TabSession["jobGenerates"][string] | null;
  customTab: TabSession["customTab"];
  progress: PipelineProgress;
  fillBusy: boolean;
  /** Recommend, fill, and advance until the application is done. */
  run: NowAction;
  fill: NowAction;
  /** Fixes only the fields the page flagged after Submit / Next. */
  refill: NowAction;
  generate: NowAction;
  recommend: NowAction;
  remember: NowAction;
};

/** What the card says about the active tab, and which generate run (if any) it shows. */
function describe({
  mainTab,
  tabJob,
  jobGenerate,
  customTab,
  fillBusy,
}: Pick<NowCardProps, "mainTab" | "tabJob" | "jobGenerate" | "customTab" | "fillBusy">) {
  if (mainTab === "custom") {
    if (!customTab) {
      return {
        title: "This tab isn’t remembered",
        subtitle: "Remember it to generate or recommend a résumé, then Fill.",
        status: null,
        run: null,
      };
    }
    const line = customTabResumeLine(customTab, fillBusy);
    return {
      title: customTab.title || "Untitled",
      subtitle: hostOf(customTab.url),
      status: line,
      run: customTab.generateProgress ?? null,
    };
  }
  if (
    customTab &&
    (customTab.resumeMode === "recommend" || customTab.workKind === "recommend") &&
    (customTab.generateStatus === "queued" ||
      customTab.generateStatus === "running" ||
      customTab.generateStatus === "failed" ||
      Boolean(customTab.recommendedResumeId))
  ) {
    const line = customTabResumeLine(customTab, fillBusy);
    const running = customTab.generateStatus === "queued" || customTab.generateStatus === "running";
    return {
      title: tabJob?.title || customTab.title || "This page",
      subtitle: tabJob?.company || hostOf(customTab.url),
      status: line,
      run: running ? (customTab.generateProgress ?? null) : null,
    };
  }
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

/** Recommend's ranked Library résumés for the active tab (Custom, or the attached Fill job). */
function recommendedTop({
  mainTab,
  customTab,
  jobGenerate,
}: Pick<NowCardProps, "mainTab" | "customTab" | "jobGenerate">): RecommendedResumeRank[] {
  if (mainTab === "custom") return customTab?.recommendedTop ?? [];
  if (jobGenerate?.recommendedTop?.length) return jobGenerate.recommendedTop;
  return customTab?.recommendedTop ?? [];
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

function RunStatus({ progress }: { progress: PipelineProgress }) {
  const run = progress.run;
  if (!run) return null;
  const failure = run.report?.failure;
  if (failure) {
    return (
      <VStack gap={1}>
        <HStack gap={2} align="center">
          <Badge variant="error" label="Run stopped" />
        </HStack>
        <Text type="supporting" weight="semibold">
          {failure.label}
        </Text>
        {failure.detail ? <Text type="supporting">{failure.detail}</Text> : null}
      </VStack>
    );
  }
  const parts = [`Page ${Math.max(run.page, 1)}`];
  if (run.refills > 0) parts.push(`refill ${run.refills}/${run.maxRefills}`);
  return <Text type="supporting">{parts.join(" · ")}</Text>;
}

function RunProgress({ run }: { run: CustomUiProgress }) {
  return (
    <VStack gap={1}>
      <GenerateProgressBar progress={run} />
      <Text type="supporting">{run.label}</Text>
    </VStack>
  );
}

/**
 * The active Chrome tab at the top of Jobs and Tabs: which job or remembered page it is,
 * its résumé, any run in flight, and the actions that work on it.
 */
export function NowCard(props: NowCardProps) {
  const {
    mainTab,
    customTab,
    progress,
    fillBusy,
    run: runAction,
    fill,
    refill,
    generate,
    recommend,
    remember,
  } = props;
  const { title, subtitle, status, run } = describe(props);
  const top = run ? [] : recommendedTop(props);
  const needsRemember = mainTab === "custom" && !customTab;
  const hasTarget = mainTab === "custom" ? Boolean(customTab) : Boolean(props.tabJob);
  const jobsRunOnly = mainTab === "fill" && JOBS_NOW_CARD_RUN_ONLY;

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
        {fillBusy ? <ProgressBar label={progress.message || "Filling…"} isIndeterminate /> : null}
        <RunStatus progress={progress} />
        {needsRemember ? (
          <VStack gap={2}>
            <Button
              variant="primary"
              icon={<Glyph name="pin" />}
              label={remember.label}
              tooltip={remember.title}
              isDisabled={remember.disabled}
              width="100%"
              onClick={remember.onClick}
            />
            <Button
              variant="secondary"
              label={recommend.label}
              tooltip={recommend.title}
              isDisabled={recommend.disabled}
              width="100%"
              onClick={recommend.onClick}
            />
          </VStack>
        ) : (
          <VStack gap={2}>
            <Button
              variant="primary"
              icon={<Glyph name="play" />}
              label={runAction.label}
              tooltip={runAction.title}
              isDisabled={runAction.disabled}
              width="100%"
              onClick={runAction.onClick}
            />
            {!jobsRunOnly ? (
              <>
                <Button
                  variant="secondary"
                  icon={<Glyph name="edit" />}
                  label={fill.label}
                  tooltip={fill.title}
                  isDisabled={fill.disabled}
                  width="100%"
                  onClick={fill.onClick}
                />
                <Button
                  variant="secondary"
                  icon={<Glyph name="refresh" />}
                  label={refill.label}
                  tooltip={refill.title}
                  isDisabled={refill.disabled}
                  width="100%"
                  onClick={refill.onClick}
                />
                {hasTarget ? (
                  <HStack gap={2} className="acorn-now-row">
                    <Button
                      variant="secondary"
                      label={generate.label}
                      tooltip={generate.title}
                      isDisabled={generate.disabled}
                      onClick={generate.onClick}
                    />
                    <Button
                      variant="secondary"
                      label={recommend.label}
                      tooltip={recommend.title}
                      isDisabled={recommend.disabled}
                      onClick={recommend.onClick}
                    />
                  </HStack>
                ) : (
                  <Button
                    variant="secondary"
                    label={recommend.label}
                    tooltip={recommend.title}
                    isDisabled={recommend.disabled}
                    width="100%"
                    onClick={recommend.onClick}
                  />
                )}
              </>
            ) : null}
          </VStack>
        )}
      </VStack>
    </Card>
  );
}
