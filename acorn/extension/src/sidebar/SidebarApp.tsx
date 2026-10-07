import { useEffect, useMemo, useState } from "react";
import { FILL_MODE } from "@acorn/shared/field-issues";
import { isFillPhaseBusy } from "@acorn/shared/pipeline-types";
import { RUN_OUTCOME } from "@acorn/shared/run-types";
import { customTabHasResume } from "../tab-custom-session";
import { countBusyWorkers, tabInputFromProgress } from "../acorn-face/director";
import { useCompanionFace } from "../acorn-face/use-companion-face";
import { pushAcornNotice } from "./acorn-notice";
import { hostOf } from "./custom-tab-resume";
import { NowCard } from "./NowCard";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarNav, type AcornMainTab } from "./SidebarNav";
import {
  REFILL_HINT,
  RUN_HINT,
  actionBarState,
  isAnyTabWorking,
  isGenerateBusy,
} from "./sidebar-work-state";
import { useActiveTabId } from "./use-active-tab";
import { usePlanInspect } from "./use-plan-inspect";
import { useResumePreview } from "./use-resume-preview";
import { useSidebarAuth } from "./use-sidebar-auth";
import { useSocketStatus } from "./use-socket-status";
import { useTabSession } from "./use-tab-session";
import { useTabUi } from "./use-tab-ui";
import { useTabWork } from "./use-tab-work";
import { AskPanel } from "./AskPanel";
import { CustomPanel } from "./CustomPanel";
import { JobsPanel } from "./JobsPanel";
import { SidebarOverlays } from "./SidebarOverlays";
import { SignedOutView } from "./SignedOutView";
import type { JdPreview } from "./sidebar-panel-types";
import "./SidebarApp.css";

export default function SidebarApp() {
  const activeTabId = useActiveTabId();
  const { tabJob, customTab, customList, jobGenerates, pipelines, progress, setPipelines } =
    useTabSession(activeTabId);

  const [jdPreview, setJdPreview] = useState<JdPreview | null>(null);
  const [mainTab, setMainTab] = useState<AcornMainTab>("fill");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qaStatus, setQaStatus] = useState({ busy: false, error: false });
  const [helpOpen, setHelpOpen] = useState(false);

  const { apiUrl, setApiUrl, session, authBusy, handleSignIn, handleSignOut } = useSidebarAuth({
    onSignedOut: () => setHelpOpen(false),
  });
  const connected = useSocketStatus(session, apiUrl);
  const { ui, patchTabUi } = useTabUi(activeTabId, progress);
  const { preview, setPreview, openCustomResumePreview } = useResumePreview(jobGenerates);

  const fillBusy = isFillPhaseBusy(progress.phase);
  const generateBusy = isGenerateBusy(customTab, tabJob, jobGenerates);
  const tabWorkBusy = fillBusy || generateBusy;
  const anyTabWorking = isAnyTabWorking(pipelines, customList, jobGenerates);
  const busyCounts = useMemo(
    () => countBusyWorkers(pipelines, customList, Object.values(jobGenerates)),
    [pipelines, customList, jobGenerates],
  );
  const busyTotal = busyCounts.thinking + busyCounts.working;
  const workersMode =
    busyCounts.working > 0 ? "working" : busyCounts.thinking > 0 ? "thinking" : "waiting";
  const fillErrorText =
    progress.phase === "error" ? progress.error || progress.message || "Fill failed" : null;
  const runErrored = progress.run?.report?.outcome === RUN_OUTCOME.failed;

  useEffect(() => {
    if (!fillErrorText) return;
    pushAcornNotice({
      kind: "error",
      title: runErrored ? "Run stopped" : "Fill couldn’t finish",
      detail: fillErrorText,
    });
  }, [fillErrorText, runErrored]);

  const runDoneText =
    progress.phase === "done" && progress.run?.report?.outcome === RUN_OUTCOME.completed
      ? progress.message
      : null;
  useEffect(() => {
    if (!runDoneText) return;
    pushAcornNotice({ kind: "success", title: "Run finished", detail: runDoneText });
  }, [runDoneText]);

  const refillDoneText =
    progress.phase === "done" && progress.mode === FILL_MODE.refill ? progress.message : null;
  useEffect(() => {
    if (!refillDoneText) return;
    pushAcornNotice({ kind: "info", title: "Refill finished", detail: refillDoneText });
  }, [refillDoneText]);

  const {
    remembering,
    startPipeline,
    startRun,
    rememberFocusedTab,
    forgetCustomTab,
    focusCustomTab,
    startCustomWork,
  } = useTabWork({
    activeTabId,
    mainTab,
    tabJob,
    customTab,
    setPipelines,
    tabWorkBusy,
  });

  const {
    lastFetch,
    plan,
    steps,
    nodeCount,
    visibleSteps,
    hasMoreSteps,
    loadMoreSteps,
    stepsListRef,
    inspectWindow,
    inspectView,
    stepSummary,
    openInspect,
  } = usePlanInspect({ activeTabId, ui, progress, patchTabUi });

  const hasTree = Boolean(lastFetch);
  const companionMode = useCompanionFace({
    signedIn: Boolean(session),
    authBusy,
    nameFocused: false,
    connected,
    anyTabWorking,
    focused: tabInputFromProgress(Boolean(session), progress, {
      status: customTab?.generateStatus ?? null,
      label: customTab?.generateProgress?.label ?? null,
      hasResume: customTab ? customTabHasResume(customTab) : false,
    }),
    qaBusy: qaStatus.busy,
    qaError: qaStatus.error,
    inspectOpen: Boolean(ui.inspect || preview || helpOpen),
    connectionOpen: settingsOpen,
    jobsLoading: false,
    jobsEmpty: false,
    jobsError: false,
    customEmpty: Boolean(session) && mainTab === "custom" && customList.length === 0,
    opening: remembering,
    marking: false,
  });

  const customLocked = mainTab === "custom" && !customTab;
  const fillLocked = mainTab === "fill" && !tabJob;
  const rememberFirst = "Remember this tab first";
  const openJobFirst = "No job on this tab";
  const actionsOff = tabWorkBusy || !session || activeTabId == null || customLocked;
  const {
    attachedJobGenerate,
    fillCanContinue,
    customCanContinue,
    generateLabel,
    recommendLabel,
    fillLabel,
    refillLabel,
    runLabel,
  } = actionBarState({
    mainTab,
    tabJob,
    customTab,
    jobGenerates,
    progress,
    fillBusy,
    generateBusy,
  });

  const headerContext =
    mainTab === "custom" && customTab
      ? hostOf(customTab.url)
      : tabJob
        ? `${tabJob.company} · ${tabJob.title}`
        : "No job on this tab";
  const nowActions = {
    run: {
      label: runLabel,
      title: RUN_HINT,
      disabled: tabWorkBusy || !session || activeTabId == null,
      onClick: () => void startRun(),
    },
    fill: {
      label: fillLabel,
      title: customLocked ? rememberFirst : fillLabel,
      disabled: actionsOff,
      onClick: () => void startPipeline(mainTab === "custom" ? "custom" : "fill"),
    },
    refill: {
      label: refillLabel,
      title: customLocked ? rememberFirst : REFILL_HINT,
      disabled: actionsOff,
      onClick: () => void startPipeline(mainTab === "custom" ? "custom" : "fill", FILL_MODE.refill),
    },
    generate: {
      label: generateLabel,
      title: customLocked ? rememberFirst : fillLocked ? openJobFirst : generateLabel,
      disabled: actionsOff || fillLocked,
      onClick: () =>
        void startCustomWork("generate", {
          continue:
            mainTab === "fill"
              ? fillCanContinue && attachedJobGenerate?.workKind !== "recommend"
              : customCanContinue && customTab?.workKind !== "recommend",
        }),
    },
    recommend: {
      label: recommendLabel,
      title: recommendLabel,
      disabled: tabWorkBusy || !session || activeTabId == null,
      onClick: () =>
        void startCustomWork("recommend", {
          continue:
            mainTab === "fill"
              ? fillCanContinue && attachedJobGenerate?.workKind === "recommend"
              : customCanContinue && customTab?.workKind === "recommend",
        }),
    },
    remember: {
      label: customTab ? "Tab remembered" : "Remember this tab",
      title: "Remember this tab for Custom",
      disabled: !session || activeTabId == null || Boolean(customTab) || tabWorkBusy,
      onClick: () => void rememberFocusedTab(),
    },
  };
  const nowCard = (tab: "fill" | "custom") => (
    <NowCard
      mainTab={tab}
      tabJob={tabJob}
      jobGenerate={attachedJobGenerate}
      customTab={customTab}
      progress={progress}
      fillBusy={fillBusy}
      {...nowActions}
    />
  );

  return (
    <div className={`sidebar-app${session ? " signed-in" : ""} tab-${session ? mainTab : "fill"}`}>
      {session ? (
        <>
          <div className="acorn-top">
            <SidebarHeader
              session={session}
              companionMode={companionMode}
              workersMode={workersMode}
              busyCounts={busyCounts}
              busyTotal={busyTotal}
              connected={connected}
              context={headerContext}
              signOutDisabled={authBusy || anyTabWorking}
              onOpenGuide={() => setHelpOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onSignOut={() => void handleSignOut()}
            />
            <SidebarNav
              value={mainTab}
              onChange={setMainTab}
              busyJobs={busyTotal}
              rememberedTabs={customList.length}
            />
          </div>

          <main className="sidebar-scroll">
            <JobsPanel
              mainTab={mainTab}
              nowCard={nowCard("fill")}
              tabId={activeTabId}
              signedIn={Boolean(session)}
              socketConnected={connected}
            />

            <AskPanel
              mainTab={mainTab}
              fillBusy={fillBusy}
              setQaStatus={setQaStatus}
              tabJob={tabJob}
              tabId={activeTabId}
            />

            <CustomPanel
              mainTab={mainTab}
              nowCard={nowCard("custom")}
              customList={customList}
              pipelines={pipelines}
              activeTabId={activeTabId}
              focusCustomTab={focusCustomTab}
              forgetCustomTab={forgetCustomTab}
              startCustomWork={startCustomWork}
              openCustomResumePreview={openCustomResumePreview}
              setJdPreview={setJdPreview}
            />
          </main>
        </>
      ) : (
        <SignedOutView
          authBusy={authBusy}
          handleSignIn={handleSignIn}
          companionMode={companionMode}
          fillBusy={fillBusy}
          hasTree={hasTree}
          lastFetch={lastFetch}
          nodeCount={nodeCount}
          plan={plan}
          steps={steps}
          stepSummary={stepSummary}
          visibleSteps={visibleSteps}
          stepsListRef={stepsListRef}
          hasMoreSteps={hasMoreSteps}
          loadMoreSteps={loadMoreSteps}
          openInspect={openInspect}
        />
      )}

      <SidebarOverlays
        activeTabId={activeTabId}
        preview={preview}
        setPreview={setPreview}
        jdPreview={jdPreview}
        setJdPreview={setJdPreview}
        ui={ui}
        patchTabUi={patchTabUi}
        inspectView={inspectView}
        inspectWindow={inspectWindow}
        helpOpen={helpOpen}
        setHelpOpen={setHelpOpen}
        busyCounts={busyCounts}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        connected={connected}
        session={session}
        apiUrl={apiUrl}
        setApiUrl={setApiUrl}
      />
    </div>
  );
}
