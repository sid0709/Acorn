import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IDLE_PIPELINE_PROGRESS,
  isFillPhaseBusy,
  mergePipelineProgress,
  type PipelineProgress,
} from "../../../shared/pipeline-types";
import type { ActionPlan, RunStepRecord } from "../../../shared/plan-runner/types";
import {
  collectLines,
  formatMetaTreePreview,
  formatPureTreePreview,
  iterateMetaTreeLines,
  iteratePureTreeLines,
  splitDomTree,
  type DomTreeNode,
} from "../../../shared/tree-export";
import {
  DEFAULT_ATHENS_API_URL,
  getAthensApiUrl,
  getOakSession,
  setAthensApiUrl,
  type OakStoredSession,
} from "../auth/oak-auth";
import { pageHasResume } from "../tab-page-session";
import { MSG, OAK_SIDEBAR_PORT, type DomNode } from "../types";
import { InspectPanel, useInspectWindow } from "./InspectPanel";
import { LoadMoreFooter } from "./LoadMoreFooter";
import { EmailsPanel } from "./EmailsPanel";
import { QaPanel } from "./QaPanel";
import { SidebarMainTabs, type OakMainTab } from "./SidebarMainTabs";
import { sendMessage } from "./runtime";
import { clearTabTree, getTabTree, setTabTree, type TabTreeSummary } from "./tab-tree-cache";
import { useActiveTabId } from "./use-active-tab";
import { useShownCount } from "./use-shown-count";
import { useTabSession } from "./use-tab-session";
import { PageList } from "./PageList";
import { FaceGuidePanel } from "./FaceGuidePanel";
import { pushOakNotice } from "./oak-notice";
import { HelpIcon } from "./sidebar-icons";
import { SidebarActionBar } from "./SidebarActionBar";
import { OAK_FACE_BADGE_PX, OAK_FACE_BRAND_PX } from "../oak-face/constants";
import { countBusyWorkers, tabInputFromProgress } from "../oak-face/director";
import { OakFaceView } from "../oak-face/OakFaceView";
import { useCompanionFace } from "../oak-face/use-companion-face";
import "./SidebarApp.css";

type InspectKind = "pure" | "meta" | "plan";

type TabUi = {
  lastFetch: TabTreeSummary | null;
  inspect: { title: string; kind: InspectKind } | null;
};

const EMPTY_TAB_UI: TabUi = {
  lastFetch: null,
  inspect: null,
};

const STEP_PAGE = 30;

/** Oak's version, from extension/package.json: the same number the manifest and the website show. */
const OAK_VERSION = import.meta.env.VITE_OAK_VERSION;

export default function SidebarApp() {
  const activeTabId = useActiveTabId();
  const { page, pageList, pipelines, progress, setPipelines } = useTabSession(activeTabId);

  const [apiUrl, setApiUrl] = useState(DEFAULT_ATHENS_API_URL);
  const [session, setSession] = useState<OakStoredSession | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [tabUi, setTabUi] = useState<Record<string, TabUi>>({});
  const [mainTab, setMainTab] = useState<OakMainTab>("fill");
  const [nameFocused, setNameFocused] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [qaStatus, setQaStatus] = useState({ busy: false, error: false });
  const [sendingTabIds, setSendingTabIds] = useState<ReadonlySet<number>>(new Set());
  const [remembering, setRemembering] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const tabKey = activeTabId != null ? String(activeTabId) : null;
  const ui = (tabKey && tabUi[tabKey]) || EMPTY_TAB_UI;
  const fillBusy = isFillPhaseBusy(progress.phase);
  const jdBusy = page?.jdStatus === "running";
  const sending = activeTabId != null && sendingTabIds.has(activeTabId);
  const tabWorkBusy = fillBusy || jdBusy || sending;
  const anyTabWorking =
    Object.values(pipelines).some((row) => isFillPhaseBusy(row.phase)) ||
    pageList.some((row) => row.jdStatus === "running") ||
    sendingTabIds.size > 0;
  const busyCounts = useMemo(() => countBusyWorkers(pipelines, pageList), [pipelines, pageList]);
  const busyTotal = busyCounts.thinking + busyCounts.working;
  const workersMode =
    busyCounts.working > 0 ? "working" : busyCounts.thinking > 0 ? "thinking" : "waiting";
  const fillErrorText =
    progress.phase === "error" ? progress.error || progress.message || "Fill failed" : null;

  useEffect(() => {
    if (!fillErrorText) return;
    pushOakNotice({
      kind: "error",
      title: "Fill couldn’t finish",
      detail: fillErrorText,
    });
  }, [fillErrorText]);

  const patchTabUi = useCallback((tabId: number, patch: Partial<TabUi>) => {
    setTabUi((prev) => {
      const key = String(tabId);
      return { ...prev, [key]: { ...(prev[key] ?? EMPTY_TAB_UI), ...patch } };
    });
  }, []);

  const setTabProgress = useCallback(
    (tabId: number, next: PipelineProgress) => {
      setPipelines((prev) => {
        const key = String(tabId);
        return {
          ...prev,
          [key]: mergePipelineProgress(prev[key] ?? IDLE_PIPELINE_PROGRESS, next),
        };
      });
    },
    [setPipelines],
  );

  useEffect(() => {
    void (async () => {
      setApiUrl(await getAthensApiUrl());
      setSession(await getOakSession());
    })();
  }, []);

  useEffect(() => {
    const onRemoved = (tabId: number) => {
      clearTabTree(tabId);
      setTabUi((prev) => {
        const key = String(tabId);
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => chrome.tabs.onRemoved.removeListener(onRemoved);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let port: chrome.runtime.Port | null = null;

    const attach = () => {
      if (cancelled) return;
      port = chrome.runtime.connect({ name: OAK_SIDEBAR_PORT });
      port.onMessage.addListener((message: { type?: string; connected?: boolean }) => {
        if (message?.type === MSG.SOCKET_STATUS) {
          setConnected(Boolean(message.connected));
        }
      });
      port.onDisconnect.addListener(() => {
        port = null;
        if (!cancelled) window.setTimeout(attach, 250);
      });
    };

    attach();
    return () => {
      cancelled = true;
      port?.disconnect();
    };
  }, []);

  useEffect(() => {
    let alive = true;

    const check = async () => {
      try {
        const res = await sendMessage<{ connected?: boolean }>({ type: MSG.SOCKET_STATUS });
        if (alive && typeof res?.connected === "boolean") {
          setConnected(res.connected);
        }
      } catch {
        if (alive) setConnected(false);
      }
    };

    check();
    const id = setInterval(check, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [session, apiUrl]);

  const cacheTree = useCallback(
    (
      tabId: number,
      payload: { url: string; title: string; fetchedAt: string; tree: DomTreeNode },
    ) => {
      const existing = getTabTree(tabId);
      if (existing?.fetchedAt === payload.fetchedAt) {
        patchTabUi(tabId, {
          lastFetch: {
            url: existing.url,
            title: existing.title,
            fetchedAt: existing.fetchedAt,
            nodeCount: existing.nodeCount,
          },
        });
        return;
      }
      const nodeCount = countNodes(payload.tree as unknown as DomNode);
      const summary: TabTreeSummary = {
        url: payload.url,
        title: payload.title,
        fetchedAt: payload.fetchedAt,
        nodeCount,
      };
      setTabTree(tabId, { ...summary, tree: payload.tree });
      patchTabUi(tabId, { lastFetch: summary });
    },
    [patchTabUi],
  );

  useEffect(() => {
    if (activeTabId == null || !progress.tree) return;
    if (!isValidTree(progress.tree.tree)) return;
    cacheTree(activeTabId, {
      url: progress.tree.url,
      title: progress.tree.title,
      fetchedAt: progress.tree.fetchedAt,
      tree: progress.tree.tree,
    });
  }, [activeTabId, progress.tree, cacheTree]);

  const handleSignIn = async () => {
    setAuthBusy(true);
    try {
      const res = await sendMessage<{
        ok?: boolean;
        error?: string;
        session?: OakStoredSession;
      }>({
        type: MSG.AUTH_SIGNIN,
        name: name.trim(),
        password,
        apiUrl,
      });
      if (!res?.ok || !res.session) {
        pushOakNotice({
          kind: "error",
          title: "Couldn’t sign in",
          detail: res?.error || "Check your email and extension password.",
        });
        return;
      }
      setSession(res.session);
      setPassword("");
      pushOakNotice({
        kind: "success",
        title: "Signed in",
        detail: `Welcome back, ${res.session.displayName}.`,
      });
    } catch (err) {
      pushOakNotice({
        kind: "error",
        title: "Couldn’t sign in",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAuthBusy(true);
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.AUTH_SIGNOUT,
      });
      if (!res?.ok) {
        pushOakNotice({
          kind: "error",
          title: "Couldn’t sign out",
          detail: res?.error || "Try again in a moment.",
        });
        return;
      }
      setSession(null);
      setHelpOpen(false);
      pushOakNotice({ kind: "success", title: "Signed out" });
    } catch (err) {
      pushOakNotice({
        kind: "error",
        title: "Couldn’t sign out",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAuthBusy(false);
    }
  };

  const startPipeline = useCallback(async () => {
    const tabId = activeTabId;
    if (tabWorkBusy || tabId == null || page?.jdStatus !== "found") return;
    setTabProgress(tabId, { phase: "fetching", message: "Starting…" });
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.START_PIPELINE,
        tabId,
      });
      if (res?.error) {
        const err = String(res.error);
        if (/sign in/i.test(err)) {
          setTabProgress(tabId, {
            phase: "idle",
            message: "Sign in to Acorn to run Oak",
          });
          pushOakNotice({
            kind: "error",
            title: "Sign in required",
            detail: "Sign in to run Fill.",
          });
          return;
        }
        setTabProgress(tabId, {
          phase: "error",
          message: "Failed to start",
          error: err,
        });
        return;
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setTabProgress(tabId, {
        phase: "error",
        message: "Failed to start",
        error: detail,
      });
    }
  }, [activeTabId, page?.jdStatus, tabWorkBusy, setTabProgress]);

  const rememberFocusedTab = useCallback(async () => {
    const tabId = activeTabId;
    if (tabId == null) return;
    setRemembering(true);
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.REMEMBER_PAGE,
        tabId,
      });
      if (!res?.ok) {
        pushOakNotice({
          kind: "error",
          title: "Couldn’t add page",
          detail: res?.error || "Try again on this page.",
        });
        return;
      }
      pushOakNotice({ kind: "success", title: "Page added" });
    } catch (err) {
      pushOakNotice({
        kind: "error",
        title: "Couldn’t add page",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRemembering(false);
    }
  }, [activeTabId]);

  const forgetPage = useCallback(async (tabId: number) => {
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.FORGET_PAGE,
        tabId,
      });
      if (!res?.ok) {
        pushOakNotice({
          kind: "error",
          title: "Couldn’t forget page",
          detail: res?.error || "Try again.",
        });
      }
    } catch (err) {
      pushOakNotice({
        kind: "error",
        title: "Couldn’t forget page",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const focusPage = useCallback(async (tabId: number) => {
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.FOCUS_PAGE,
        tabId,
      });
      if (!res?.ok) {
        pushOakNotice({
          kind: "error",
          title: "Couldn’t switch tab",
          detail: res?.error || "That tab is no longer open.",
        });
      }
    } catch (err) {
      pushOakNotice({
        kind: "error",
        title: "Couldn’t switch tab",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const startJdShot = useCallback(async () => {
    const tabId = activeTabId;
    if (tabWorkBusy || tabId == null) return;
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.START_JD_SHOT,
        tabId,
      });
      if (!res?.ok) {
        pushOakNotice({
          kind: "error",
          title: "Couldn’t take the JD shot",
          detail: res?.error || "Try again on this page.",
        });
      }
    } catch (err) {
      pushOakNotice({
        kind: "error",
        title: "Couldn’t take the JD shot",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }, [activeTabId, tabWorkBusy]);

  const sendCurrentPage = useCallback(async () => {
    const tabId = activeTabId;
    if (tabWorkBusy || tabId == null || page?.jdStatus !== "found") return;
    setSendingTabIds((prev) => new Set(prev).add(tabId));
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.SENT_PAGE,
        tabId,
      });
      if (!res?.ok) {
        pushOakNotice({
          kind: "error",
          title: "Couldn’t mark as sent",
          detail: res?.error || "Try again.",
        });
        return;
      }
      pushOakNotice({
        kind: "success",
        title: "Sent",
        detail: "Counted on your dashboard.",
      });
    } catch (err) {
      pushOakNotice({
        kind: "error",
        title: "Couldn’t mark as sent",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSendingTabIds((prev) => {
        const next = new Set(prev);
        next.delete(tabId);
        return next;
      });
    }
  }, [activeTabId, page?.jdStatus, tabWorkBusy]);

  // Each page's cost is read from the backend when it first shows up in the list.
  const costAskedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const asked = costAskedRef.current;
    const live = new Set(pageList.map((row) => row.tabId));
    for (const tabId of asked) {
      if (!live.has(tabId)) asked.delete(tabId);
    }
    for (const tabId of live) {
      if (asked.has(tabId)) continue;
      asked.add(tabId);
      void sendMessage({ type: MSG.REFRESH_PAGE_COST, tabId });
    }
  }, [pageList]);

  const lastFetch = ui.lastFetch;
  const inspectKind = ui.inspect?.kind ?? null;
  const treeStamp = lastFetch?.fetchedAt;

  const splitTrees = useMemo(() => {
    if (inspectKind !== "pure" && inspectKind !== "meta") return null;
    if (activeTabId == null) return null;
    const tree = getTabTree(activeTabId)?.tree;
    if (!tree) return null;
    return splitDomTree(tree);
  }, [inspectKind, activeTabId, treeStamp]);

  const plan: ActionPlan | undefined = progress.plan;
  const steps: RunStepRecord[] = progress.steps ?? [];
  const nodeCount = lastFetch?.nodeCount ?? 0;

  const {
    shownCount: stepShown,
    loadMore: loadMoreSteps,
    ensureCount: ensureStepCount,
  } = useShownCount(STEP_PAGE, plan);
  const visibleSteps = steps.slice(0, stepShown);
  const hasMoreSteps = stepShown < steps.length;
  const stepsListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const runningIdx = steps.findIndex(
      (step) => step.status === "running" || step.status === "paused",
    );
    if (runningIdx >= 0) ensureStepCount(runningIdx + 1);
  }, [steps, ensureStepCount]);

  const inspectWindow = useInspectWindow(inspectKind);

  const inspectView = useMemo(() => {
    if (!inspectKind) return null;
    if (inspectKind === "plan") {
      const all = JSON.stringify(plan ?? {}, null, 2).split("\n");
      return {
        lines: all.slice(0, inspectWindow.shownCount),
        hasMore: inspectWindow.shownCount < all.length,
        copy: () => navigator.clipboard.writeText(all.join("\n")),
      };
    }
    if (!splitTrees) return { lines: [] as string[], hasMore: false, copy: async () => undefined };
    if (inspectKind === "pure") {
      const collected = collectLines(
        iteratePureTreeLines(splitTrees.pure),
        inspectWindow.shownCount,
      );
      return {
        ...collected,
        copy: () => navigator.clipboard.writeText(formatPureTreePreview(splitTrees.pure)),
      };
    }
    const collected = collectLines(
      iterateMetaTreeLines(splitTrees.meta, splitTrees.pure),
      inspectWindow.shownCount,
    );
    return {
      ...collected,
      copy: () =>
        navigator.clipboard.writeText(formatMetaTreePreview(splitTrees.meta, splitTrees.pure)),
    };
  }, [inspectKind, inspectWindow.shownCount, plan, splitTrees]);

  const stepSummary = {
    ok: steps.filter((s) => s.status === "ok").length,
    skipped: steps.filter((s) => s.status === "skipped").length,
    blocked: steps.filter((s) => s.status === "blocked").length,
    failed: steps.filter((s) => s.status === "failed" || s.status === "aborted").length,
  };

  const openInspect = (kind: InspectKind, title: string) => {
    if (activeTabId == null) return;
    patchTabUi(activeTabId, { inspect: { title, kind } });
  };

  const connectionLabel = connected ? "Connected" : session ? "Offline" : "Sign in";
  const footerStatus = fillBusy ? progress.message : connectionLabel;
  const hasTree = Boolean(lastFetch);
  const companionMode = useCompanionFace({
    signedIn: Boolean(session),
    authBusy,
    nameFocused,
    connected,
    anyTabWorking,
    focused: tabInputFromProgress(Boolean(session), progress, page?.jdStatus ?? null),
    qaBusy: qaStatus.busy,
    qaError: qaStatus.error,
    inspectOpen: Boolean(ui.inspect || helpOpen),
    connectionOpen,
    pagesEmpty: Boolean(session) && mainTab === "fill" && pageList.length === 0,
    remembering,
    sending,
  });

  const showActionBar = Boolean(session) && mainTab === "fill" && !helpOpen;
  const actionsOff = tabWorkBusy || !session || activeTabId == null;
  const jdShotLabel = jdBusy
    ? "Reading…"
    : page && pageHasResume(page)
      ? "JD shot again"
      : "JD shot";
  const jdShotTitle = jdBusy
    ? "Reading this page for a job description"
    : "Take a shot of the job description: Oak checks it is a posting and picks a résumé";
  const sentLabel = sending ? "Sending…" : "Sent";
  // Fill and Sent need a JD shot that found a posting: the job description picks the résumé Fill
  // uploads, and the application is counted against that job.
  const jdDone = page?.jdStatus === "found";
  const sentDisabled = actionsOff || !jdDone;
  const fillDisabled = actionsOff || !jdDone;
  const fillTitle = jdBusy
    ? "Wait for the JD shot to finish"
    : jdDone
      ? undefined
      : "Take a JD shot of this page first";
  const sentTitle = jdBusy
    ? "Wait for the JD shot to finish"
    : jdDone
      ? "Take a full-page screenshot, count this page as sent, and close the tab"
      : "Take a JD shot of this page first";
  const fillLabel = fillBusy
    ? progress.message
    : progress.phase === "done"
      ? "Fill again"
      : "Fill page";

  return (
    <div
      className={`sidebar-app${session ? " signed-in" : ""} tab-${
        session ? mainTab : "fill"
      }${showActionBar ? " has-fill-cta" : ""}${helpOpen ? " help-open" : ""}`}
    >
      <div className="sidebar-scroll">
        <div className="sidebar-chrome">
          <section className="welcome">
            <div className="brand-bar">
              <OakFaceView
                className="brand-logo"
                mode={companionMode}
                size={OAK_FACE_BRAND_PX}
                live
                label="Oak"
              />
              <h2>Oak</h2>
              {session ? (
                <>
                  <p className="brand-user">{session.displayName}</p>
                  <div className="brand-actions">
                    <div
                      className={`brand-workers${busyTotal > 0 ? " is-busy" : ""}`}
                      role="status"
                      aria-live="polite"
                      title={
                        busyTotal > 0
                          ? `${busyTotal} working · ${busyCounts.thinking} thinking, ${busyCounts.working} filling`
                          : "No workers in flight"
                      }
                      aria-label={`${busyTotal} working`}
                    >
                      <OakFaceView
                        className="brand-workers-face"
                        mode={workersMode}
                        size={OAK_FACE_BADGE_PX}
                        live={busyTotal > 0}
                        label="Workers"
                      />
                      <span className="brand-workers-count">{busyTotal}</span>
                    </div>
                    <button
                      type="button"
                      className={`brand-icon-btn${helpOpen ? " is-open" : ""}`}
                      onClick={() => setHelpOpen((open) => !open)}
                      title={helpOpen ? "Close Oak Face guide" : "Oak Face guide"}
                      aria-label={helpOpen ? "Close Oak Face guide" : "Oak Face guide"}
                      aria-pressed={helpOpen}
                    >
                      <HelpIcon />
                    </button>
                    <button
                      type="button"
                      className="brand-icon-btn"
                      onClick={() => void handleSignOut()}
                      disabled={authBusy || anyTabWorking}
                      title="Sign out"
                      aria-label="Sign out"
                    >
                      <SignOutIcon />
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </section>

          {session ? null : (
            <section className="connection">
              <div className="auth-form">
                <label className="field">
                  <span>Email</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onFocus={() => setNameFocused(true)}
                    onBlur={() => setNameFocused(false)}
                    autoComplete="email"
                    placeholder="Acorn email"
                  />
                </label>
                <label className="field">
                  <span>Extension password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="Acorn extension password"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSignIn();
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="tool-card primary"
                  onClick={() => void handleSignIn()}
                  disabled={authBusy || !name.trim() || !password}
                >
                  {authBusy ? "Signing in…" : "Sign in"}
                </button>
              </div>
            </section>
          )}
        </div>

        {helpOpen ? (
          <FaceGuidePanel thinking={busyCounts.thinking} working={busyCounts.working} />
        ) : (
          <>
            <section className="tools">
              {session ? <SidebarMainTabs value={mainTab} onChange={setMainTab} /> : <h3>Fill</h3>}
              {session ? (
                <div
                  id="oak-panel-qa"
                  className="sidebar-tab-panel"
                  role="tabpanel"
                  aria-labelledby="oak-tab-qa"
                  hidden={mainTab !== "qa"}
                >
                  <QaPanel
                    signedIn
                    showHeading={false}
                    disabled={fillBusy}
                    onStatus={setQaStatus}
                    tabId={activeTabId}
                    page={page ? { title: page.title, url: page.url } : null}
                  />
                </div>
              ) : null}

              {session ? (
                <div
                  id="oak-panel-emails"
                  className="sidebar-tab-panel"
                  role="tabpanel"
                  aria-labelledby="oak-tab-emails"
                  hidden={mainTab !== "emails"}
                >
                  <EmailsPanel active={mainTab === "emails"} />
                </div>
              ) : null}

              {session ? (
                <div
                  id="oak-panel-fill"
                  className="sidebar-tab-panel"
                  role="tabpanel"
                  aria-labelledby="oak-tab-fill"
                  hidden={mainTab !== "fill"}
                >
                  <button
                    type="button"
                    className="tool-card"
                    onClick={() => void rememberFocusedTab()}
                    disabled={!session || activeTabId == null || Boolean(page) || tabWorkBusy}
                  >
                    <span className="tool-label">{page ? "Page added" : "Add this page"}</span>
                  </button>
                </div>
              ) : null}
            </section>

            {session ? (
              <div className="sidebar-list-slot" hidden={mainTab !== "fill"}>
                <PageList
                  pages={pageList}
                  pipelines={pipelines}
                  activeTabId={activeTabId}
                  sendingTabIds={sendingTabIds}
                  listActive={mainTab === "fill"}
                  onFocus={(tabId) => void focusPage(tabId)}
                  onForget={(tabId) => void forgetPage(tabId)}
                />
              </div>
            ) : null}

            <div className="sidebar-after">
              {lastFetch ? (
                <section className="preview">
                  <h3>Analyzed tree</h3>
                  <div className="preview-card">
                    <div className="preview-title">{String(lastFetch.title ?? "Untitled")}</div>
                    <div className="preview-url">{String(lastFetch.url ?? "")}</div>
                    <div className="preview-meta">
                      <span>{nodeCount} nodes</span>
                      <span>{new Date(lastFetch.fetchedAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="tree-actions">
                      <button
                        type="button"
                        disabled={!hasTree}
                        onClick={() => openInspect("pure", "Pure Tree")}
                      >
                        Pure Tree
                      </button>
                      <button
                        type="button"
                        disabled={!hasTree}
                        onClick={() => openInspect("meta", "Meta Tree")}
                      >
                        Meta Tree
                      </button>
                      <button
                        type="button"
                        disabled={!plan}
                        onClick={() => openInspect("plan", "AI Analyze")}
                      >
                        {plan ? "AI Analyze" : "AI Analyze (pending)"}
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}

              {steps.length > 0 ? (
                <section className="plan-run">
                  <h3>Plan run</h3>
                  {plan?.goal && <p className="plan-goal">{plan.goal}</p>}
                  <div className="plan-run-summary">
                    <span>ok {stepSummary.ok}</span>
                    <span>skipped {stepSummary.skipped}</span>
                    <span>blocked {stepSummary.blocked}</span>
                    <span>failed {stepSummary.failed}</span>
                    {fillBusy && <span className="plan-run-live">running…</span>}
                  </div>
                  <div ref={stepsListRef} className="plan-run-scroll">
                    <ul className="plan-run-steps">
                      {visibleSteps.map((step) => (
                        <li key={step.index} className={`plan-step status-${step.status}`}>
                          <span className="plan-step-idx">{step.index + 1}</span>
                          <span className="plan-step-action">{step.action}</span>
                          <span className="plan-step-status">{stepStatusLabel(step)}</span>
                          <span className="plan-step-target">
                            {step.element_index != null ? `[${step.element_index}]` : "—"}
                            {step.expected_label ? ` ${step.expected_label}` : ""}
                          </span>
                          {step.message && <span className="plan-step-msg">{step.message}</span>}
                        </li>
                      ))}
                    </ul>
                    <LoadMoreFooter
                      hasMore={hasMoreSteps}
                      onLoadMore={loadMoreSteps}
                      rootRef={stepsListRef}
                      label={`Load more (${visibleSteps.length} of ${steps.length})`}
                    />
                  </div>
                </section>
              ) : null}
            </div>
          </>
        )}
      </div>

      {ui.inspect && inspectView ? (
        <InspectPanel
          title={ui.inspect.title}
          lines={inspectView.lines}
          hasMore={inspectView.hasMore}
          onLoadMore={inspectWindow.loadMore}
          onCopy={inspectView.copy}
          onClose={() => {
            if (activeTabId != null) patchTabUi(activeTabId, { inspect: null });
          }}
        />
      ) : null}

      {showActionBar ? (
        <SidebarActionBar
          fillPhase={progress.phase}
          fillLabel={fillLabel}
          jdShotLabel={jdShotLabel}
          sentLabel={sentLabel}
          fillDisabled={fillDisabled}
          jdShotDisabled={actionsOff}
          sentDisabled={sentDisabled}
          fillTitle={fillTitle ?? fillLabel}
          jdShotTitle={jdShotTitle}
          sentTitle={sentTitle}
          onFill={() => void startPipeline()}
          onJdShot={() => void startJdShot()}
          onSent={() => void sendCurrentPage()}
        />
      ) : null}

      <footer className={`status-bar phase-${progress.phase}`}>
        <details
          className="oak-connection-footer"
          onToggle={(event) => setConnectionOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="oak-connection-summary">
            <span className={`oak-settings-dot ${connected ? "on" : "off"}`} aria-hidden="true" />
            <span className="oak-connection-title">Connection</span>
            <span className="oak-connection-state">{footerStatus}</span>
            <span className="oak-connection-version">v{OAK_VERSION}</span>
          </summary>
          <div className="oak-connection-body">
            <label className="field">
              <span>Oak API URL</span>
              <input
                value={apiUrl}
                onChange={(e) => {
                  const value = e.target.value;
                  setApiUrl(value);
                  void setAthensApiUrl(value);
                }}
                placeholder={DEFAULT_ATHENS_API_URL}
              />
            </label>
            <div className={`conn-status ${connected ? "on" : "off"}`}>
              <span className="dot" />
              {connected ? "Socket connected" : session ? "Socket offline" : "Sign in to connect"}
            </div>
          </div>
        </details>
      </footer>
    </div>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none">
      <path
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.5 4.5H6.2A1.7 1.7 0 0 0 4.5 6.2v7.6A1.7 1.7 0 0 0 6.2 15.5h2.3M11 6.5 14.5 10 11 13.5M14.5 10H8"
      />
    </svg>
  );
}

function stepStatusLabel(step: RunStepRecord): string {
  if (step.status === "ok") return "verified";
  return step.status;
}

function isValidTree(tree: unknown): tree is DomNode {
  return Boolean(tree && typeof tree === "object" && "tag" in (tree as object));
}

function countNodes(node: DomNode | undefined): number {
  if (!node) return 0;
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
}
