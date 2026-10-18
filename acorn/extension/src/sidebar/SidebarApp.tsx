import { isFillPhaseBusy } from "@acorn/shared/pipeline-types";
import { CLAIM_STATUS } from "@acorn/support-chat";
import { useEffect, useMemo, useState } from "react";

import { countBusyWorkers, tabInputFromProgress } from "../acorn-face/director";
import { useCompanionFace } from "../acorn-face/use-companion-face";
import { MSG } from "../types";

import { pushAcornNotice } from "./acorn-notice";
import { AskPanel } from "./AskPanel";
import { JobsPanel } from "./JobsPanel";
import { LogsPanel } from "./LogsPanel";
import { NowCard } from "./NowCard";
import { ReportDialog } from "./ReportDialog";
import { sendMessage } from "./runtime";
import { RUN_HINT, isAnyTabWorking, runButtonLabel } from "./sidebar-work-state";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarNav, type AcornMainTab } from "./SidebarNav";
import { SidebarOverlays } from "./SidebarOverlays";
import { SignedOutView } from "./SignedOutView";
import { SupportPanel } from "./SupportPanel";
import { UpdateDialog } from "./UpdateDialog";
import { useActiveTabId } from "./use-active-tab";
import { useAvailableUpdate } from "./use-available-update";
import { useSidebarAuth } from "./use-sidebar-auth";
import { useSocketStatus } from "./use-socket-status";
import { useSupportClaims } from "./use-support-claims";
import { useTabSession } from "./use-tab-session";
import { useTabWork } from "./use-tab-work";
import { useWorkEndNotices } from "./use-work-end-notices";

import "./SidebarApp.css";

export default function SidebarApp() {
  const activeTabId = useActiveTabId();
  const { pipelines, progress, setPipelines } = useTabSession(activeTabId);

  const [mainTab, setMainTab] = useState<AcornMainTab>("fill");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qaStatus, setQaStatus] = useState({ busy: false, error: false });
  const [helpOpen, setHelpOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Bumped on every open so the dialog remounts and starts with no notes or picked report.
  const [reportRun, setReportRun] = useState(0);
  const availableUpdate = useAvailableUpdate();
  const [reportSending, setReportSending] = useState(false);

  const { apiUrl, setApiUrl, session, authBusy, handleSignIn, handleSignOut } = useSidebarAuth({
    onSignedOut: () => setHelpOpen(false),
  });
  const connected = useSocketStatus(session, apiUrl);
  const support = useSupportClaims({
    signedIn: Boolean(session),
    visible: mainTab === "support",
    connected,
  });
  // The report names the tab it was opened on, so another tab's page must not inherit it.
  useEffect(() => {
    setReportOpen(false);
  }, [activeTabId]);
  const openReport = () => {
    setReportRun((run) => run + 1);
    setReportOpen(true);
  };

  const fillBusy = isFillPhaseBusy(progress.phase);
  const tabWorkBusy = fillBusy;
  const anyTabWorking = isAnyTabWorking(pipelines);
  const busyCounts = useMemo(() => countBusyWorkers(pipelines), [pipelines]);
  const busyTotal = busyCounts.thinking + busyCounts.working;
  const workersMode =
    busyCounts.working > 0 ? "working" : busyCounts.thinking > 0 ? "thinking" : "waiting";
  useWorkEndNotices(pipelines);

  const { startRun, stopRun, answerRun } = useTabWork({
    activeTabId,
    setPipelines,
    tabWorkBusy,
  });

  const runLabel = runButtonLabel(progress, fillBusy);

  const companionMode = useCompanionFace({
    signedIn: Boolean(session),
    authBusy,
    nameFocused: false,
    connected,
    anyTabWorking,
    focused: tabInputFromProgress(Boolean(session), progress),
    qaBusy: qaStatus.busy,
    qaError: qaStatus.error,
    inspectOpen: helpOpen,
    connectionOpen: settingsOpen,
    jobsLoading: false,
    jobsEmpty: false,
    jobsError: false,
    opening: false,
  });

  const nowActions = {
    run: {
      label: runLabel,
      title: RUN_HINT,
      disabled: tabWorkBusy || !session || activeTabId == null,
      onClick: () => void startRun(),
    },
    // Shown when the last run on this tab stopped partway: carry on from that point.
    continueRun:
      progress.run?.canContinue && !tabWorkBusy && session && activeTabId != null
        ? {
            label: "Continue",
            title: "Carry on from where the run stopped, without starting over",
            disabled: false,
            onClick: () => void startRun(true),
          }
        : null,
    // Shown only while a Run works on this tab.
    stop:
      fillBusy && progress.run
        ? {
            label: "Stop",
            title: "Stop the run now; the page is left as it is",
            disabled: false,
            onClick: () => void stopRun(),
          }
        : null,
    answerRun: (optionId: string) => void answerRun(optionId),
  };
  // Report stays available while work runs: a stuck run is exactly what people report.
  const reportDisabled = !session || activeTabId == null;
  const submitReport = async (notes: string, claimId: string | null): Promise<boolean> => {
    if (activeTabId == null) return false;
    setReportSending(true);
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string; claimId?: string }>({
        type: MSG.SUBMIT_SUPPORT_CLAIM,
        tabId: activeTabId,
        notes,
        claimId,
      });
      if (!res?.ok) {
        pushAcornNotice({
          kind: "error",
          title: "Couldn’t send report",
          detail: res?.error ?? "Try again in a moment.",
          tabId: activeTabId,
        });
        return false;
      }
      setReportOpen(false);
      pushAcornNotice({
        kind: "success",
        title: claimId ? "Added to your report" : "Report sent",
        detail: "Support has the page and your notes. Replies show in the Support tab.",
        tabId: activeTabId,
      });
      setMainTab("support");
      await support.open(res.claimId ?? null);
      return true;
    } finally {
      setReportSending(false);
    }
  };

  const nowCard = <NowCard progress={progress} fillBusy={fillBusy} {...nowActions} />;

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
              signOutDisabled={authBusy || anyTabWorking}
              onOpenGuide={() => setHelpOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onReport={openReport}
              reportDisabled={reportDisabled}
              onSignOut={() => void handleSignOut()}
            />
            <SidebarNav
              value={mainTab}
              onChange={setMainTab}
              busyJobs={busyTotal}
              unreadSupport={support.unread}
            />
          </div>

          <main className="sidebar-scroll">
            <JobsPanel
              mainTab={mainTab}
              nowCard={nowCard}
              tabId={activeTabId}
              signedIn={Boolean(session)}
              socketConnected={connected}
            />

            <AskPanel
              mainTab={mainTab}
              fillBusy={fillBusy}
              setQaStatus={setQaStatus}
              tabId={activeTabId}
            />

            <SupportPanel
              mainTab={mainTab}
              support={support}
              onReport={openReport}
              reportDisabled={reportDisabled}
            />

            <LogsPanel mainTab={mainTab} tabId={activeTabId} />
          </main>
          <ReportDialog
            key={reportRun}
            isOpen={reportOpen}
            onOpenChange={setReportOpen}
            openClaims={support.claims.filter((claim) => claim.status === CLAIM_STATUS.open)}
            sending={reportSending}
            onSend={submitReport}
          />
        </>
      ) : (
        <SignedOutView
          authBusy={authBusy}
          handleSignIn={handleSignIn}
          companionMode={companionMode}
        />
      )}

      <UpdateDialog update={availableUpdate.update} onDismiss={availableUpdate.dismiss} />
      <SidebarOverlays
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
