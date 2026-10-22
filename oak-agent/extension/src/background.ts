import type { Socket } from "socket.io-client";
import type { PipelineProgress } from "../../shared/pipeline-types";
import {
  authHeaders,
  getAccessToken,
  getAthensApiUrl,
  getOakSession,
  oakSignIn,
  oakSignOut,
} from "./auth/oak-auth";
import {
  connectOakSocket,
  getOakSocket,
  isOakSocketConnected,
  scheduleConnectOakSocket,
  type OakSocketHandlers,
} from "./oak-socket";
import { matchOptionViaAnalyze } from "./pipeline/match-option-analyze";
import { runFabPipeline } from "./pipeline/run-pipeline";
import { runJdShot } from "./pipeline/jd-shot";
import { refreshPageCost } from "./pipeline/page-cost";
import { requestQaAnswer } from "./pipeline/ai-client";
import { sendPage } from "./pipeline/sent-page";
import { focusChromeTab } from "./focus-tab";
import { bindContentScriptInjection, injectIntoOpenTabs } from "./inject-content";
import { sendPlanStepToTab } from "./tab-messaging";
import { forgetTabKey, rekeyTabKey } from "./tab-key";
import {
  getPage,
  refreshPageMeta,
  rekeyPage,
  rememberPage,
  resetInterruptedJdShots,
  unbindPage,
  type OakPageBinding,
} from "./tab-page-session";
import { clearTabPipeline, queueTabPipeline, rekeyTabPipeline } from "./tab-pipeline-session";
import { broadcastOperatorNotice, socketErrorDetail } from "./operator-notice";
import {
  MSG,
  OAK_SIDEBAR_PORT,
  type DomTreePayload,
  type ExecuteActionsPayload,
  type GetContentPayload,
  type HighlightPayload,
  type MatchOptionRequest,
  type MatchOptionResponse,
  type PlanStepSocketPayload,
} from "./types";

let socketErrorToastAt = 0;
const SOCKET_TOAST_MS = 12_000;
const sidebarPorts = new Set<chrome.runtime.Port>();
/** Tabs with an in-flight Fill pipeline (parallel across tabs; one per tab). */
const pipelineRunningTabIds = new Set<number>();
const jdShotTabIds = new Set<number>();
const sentTabIds = new Set<number>();

/** The cost on a page's card is read from the backend at most this often while its work runs. */
const COST_REFRESH_MIN_MS = 3000;
const costRefreshAt = new Map<number, number>();
const costRefreshTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Reads the page's cost soon, at most once per COST_REFRESH_MIN_MS, so a busy Fill does not hammer the backend. */
function scheduleCostRefresh(tabId: number, immediate = false): void {
  if (costRefreshTimers.has(tabId)) return;
  const wait = immediate
    ? 0
    : Math.max(0, (costRefreshAt.get(tabId) ?? 0) + COST_REFRESH_MIN_MS - Date.now());
  const timer = setTimeout(() => {
    costRefreshTimers.delete(tabId);
    costRefreshAt.set(tabId, Date.now());
    void getAthensApiUrl().then((apiUrl) => refreshPageCost(tabId, apiUrl));
  }, wait);
  costRefreshTimers.set(tabId, timer);
}

/** Remembers the tab as a page if it is not one yet. */
async function ensurePage(tabId: number): Promise<OakPageBinding> {
  const existing = await getPage(tabId);
  if (existing) return existing;
  const tab = await chrome.tabs.get(tabId);
  return rememberPage({
    tabId,
    url: String(tab.url || ""),
    title: String(tab.title || "Untitled"),
    favIconUrl: tab.favIconUrl || null,
  });
}

function enableSidePanelOnActionClick(): void {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
}

/** Tab the caller pinned. Never the currently focused tab — Fill must stay on the tab that was active at click. */
function pinnedTabId(requestedTabId: unknown, sender: chrome.runtime.MessageSender): number | null {
  if (typeof requestedTabId === "number" && Number.isFinite(requestedTabId)) {
    return requestedTabId;
  }
  return sender.tab?.id ?? null;
}

function broadcastPipelineProgress(tabId: number, progress: PipelineProgress): void {
  getOakSocket()?.emit("pipeline:progress", { tabId, progress });
  void queueTabPipeline(tabId, progress);
  if (progress.phase !== "idle") {
    scheduleCostRefresh(tabId, progress.phase === "done" || progress.phase === "error");
  }
  chrome.runtime.sendMessage({ type: MSG.PIPELINE_PROGRESS, tabId, progress }, () => {
    void chrome.runtime.lastError;
  });
}

const KEEP_ALIVE_ALARM = "oak-socket-keep-alive";
const WORK_KEEP_ALIVE_ALARM = "oak-work-keep-alive";
chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.5 });

function anyTabWorking(): boolean {
  return pipelineRunningTabIds.size > 0 || jdShotTabIds.size > 0 || sentTabIds.size > 0;
}

async function closeTabsQuietly(tabIds: number[]): Promise<void> {
  const ids = [...new Set(tabIds.filter((id) => Number.isFinite(id)))];
  if (ids.length === 0) return;
  try {
    await chrome.tabs.remove(ids);
  } catch {
    await Promise.all(ids.map((id) => chrome.tabs.remove(id).catch(() => undefined)));
  }
}

function syncWorkKeepAlive(): void {
  if (anyTabWorking()) {
    chrome.alarms.create(WORK_KEEP_ALIVE_ALARM, { periodInMinutes: 0.5 });
    return;
  }
  void chrome.alarms.clear(WORK_KEEP_ALIVE_ALARM);
}

function pushSocketStatus(connected: boolean): void {
  const message = { type: MSG.SOCKET_STATUS, connected };
  for (const port of sidebarPorts) {
    try {
      port.postMessage(message);
    } catch {
      sidebarPorts.delete(port);
    }
  }
}

function bindSocketRelay(socket: Socket): void {
  socket.on("dom:highlight", async (payload: HighlightPayload) => {
    const { tabId, nodeId } = payload;
    if (!tabId || nodeId == null) return;
    try {
      await chrome.tabs.sendMessage(tabId, { type: MSG.HIGHLIGHT, nodeId });
    } catch {
      /* tab has no content script */
    }
  });

  socket.on("dom:get-content", (payload: GetContentPayload, ack?: (res: unknown) => void) => {
    const { tabId, nodeId, contentType } = payload;
    if (!tabId || nodeId == null || !contentType) {
      ack?.({ error: "Invalid payload" });
      return;
    }
    chrome.tabs.sendMessage(tabId, { type: MSG.GET_CONTENT, nodeId, contentType }, (res) => {
      if (chrome.runtime.lastError) {
        ack?.({ error: chrome.runtime.lastError.message });
        return;
      }
      ack?.(res);
    });
  });

  socket.on(
    "dom:execute-actions",
    (payload: ExecuteActionsPayload, ack?: (res: unknown) => void) => {
      const { tabId, nodeId, steps } = payload;
      if (!tabId || nodeId == null || !steps?.length) {
        ack?.({ error: "Invalid payload" });
        return;
      }
      chrome.tabs.sendMessage(tabId, { type: MSG.EXECUTE_ACTIONS, nodeId, steps }, (res) => {
        if (chrome.runtime.lastError) {
          ack?.({ error: chrome.runtime.lastError.message });
          return;
        }
        ack?.(res);
      });
    },
  );

  socket.on("dom:plan-step", (payload: PlanStepSocketPayload, ack?: (res: unknown) => void) => {
    const { tabId, step, frameId } = payload ?? {};
    if (!tabId || !step?.action) {
      ack?.({ ok: false, error: "Missing tabId or step" });
      return;
    }
    void sendPlanStepToTab(tabId, step, frameId)
      .then((res) => ack?.(res))
      .catch((err) =>
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  });
}

const socketHandlers: OakSocketHandlers = {
  bindEvents: bindSocketRelay,
  onConnected: () => {
    const recovered = socketErrorToastAt > 0;
    pushSocketStatus(true);
    if (recovered) {
      socketErrorToastAt = 0;
      broadcastOperatorNotice({
        kind: "success",
        title: "Connected",
        detail: "Oak socket is online.",
      });
    }
  },
  onDisconnected: () => {
    pushSocketStatus(false);
  },
  onConnectError: (err) => {
    if (isOakSocketConnected()) return;
    pushSocketStatus(false);
    const now = Date.now();
    if (now - socketErrorToastAt < SOCKET_TOAST_MS) return;
    socketErrorToastAt = now;
    broadcastOperatorNotice({
      kind: "error",
      title: "Couldn’t connect",
      detail: socketErrorDetail(err.message),
    });
  },
};

function connectSocket(): Promise<void> {
  return connectOakSocket(socketHandlers);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    if (sidebarPorts.size > 0) void chrome.runtime.getPlatformInfo();
    if (!isOakSocketConnected()) void connectSocket().catch(() => undefined);
  }
  if (alarm.name === WORK_KEEP_ALIVE_ALARM) {
    if (anyTabWorking()) void chrome.runtime.getPlatformInfo();
    else void chrome.alarms.clear(WORK_KEEP_ALIVE_ALARM);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== OAK_SIDEBAR_PORT) return;
  sidebarPorts.add(port);
  try {
    port.postMessage({
      type: MSG.SOCKET_STATUS,
      connected: isOakSocketConnected(),
    });
  } catch {
    sidebarPorts.delete(port);
    return;
  }
  void connectSocket().catch(() => undefined);
  port.onDisconnect.addListener(() => {
    sidebarPorts.delete(port);
  });
});

void connectSocket().catch(() => undefined);
void resetInterruptedJdShots();
enableSidePanelOnActionClick();
bindContentScriptInjection();
void injectIntoOpenTabs();
chrome.runtime.onInstalled.addListener(enableSidePanelOnActionClick);

chrome.tabs.onRemoved.addListener((tabId) => {
  void unbindPage(tabId);
  void clearTabPipeline(tabId);
  void forgetTabKey(tabId);
  costRefreshAt.delete(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (pipelineRunningTabIds.delete(removedTabId)) {
    pipelineRunningTabIds.add(addedTabId);
  }
  if (jdShotTabIds.delete(removedTabId)) {
    jdShotTabIds.add(addedTabId);
  }
  void rekeyTabKey(removedTabId, addedTabId);
  void rekeyPage(removedTabId, addedTabId);
  void rekeyTabPipeline(removedTabId, addedTabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    !changeInfo.url &&
    !changeInfo.title &&
    !changeInfo.favIconUrl &&
    changeInfo.status !== "complete"
  ) {
    return;
  }
  void refreshPageMeta(tabId, {
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.athensApiUrl || changes.oakSession) {
    scheduleConnectOakSocket(socketHandlers);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.SOCKET_STATUS) {
    sendResponse({ connected: isOakSocketConnected() });
    return true;
  }

  if (message.type === MSG.AUTH_STATUS) {
    void getOakSession().then((session) => {
      sendResponse({
        signedIn: Boolean(session),
        session,
        connected: isOakSocketConnected(),
      });
    });
    return true;
  }

  if (message.type === MSG.AUTH_SIGNIN) {
    void (async () => {
      const result = await oakSignIn(
        String(message.name || ""),
        String(message.password || ""),
        typeof message.apiUrl === "string" ? message.apiUrl : undefined,
      );
      if (!result.ok) {
        sendResponse({ ok: false, error: result.error });
        return;
      }
      await connectSocket().catch(() => undefined);
      sendResponse({ ok: true, session: result.session });
    })();
    return true;
  }

  if (message.type === MSG.AUTH_SIGNOUT) {
    void (async () => {
      try {
        await oakSignOut();
        await connectSocket().catch(() => undefined);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (message.type === MSG.SELECTION_QA) {
    void (async () => {
      try {
        const session = await getOakSession();
        if (!session) {
          sendResponse({ ok: false, error: "Sign in to Oak" });
          return;
        }
        const question = String(message.question || "").trim();
        if (!question) {
          sendResponse({ ok: false, error: "Select some text first." });
          return;
        }
        const tabId = sender.tab?.id;
        const apiUrl = await getAthensApiUrl();
        const answer = await requestQaAnswer(
          {
            question,
            page: {
              title: String(message.title || ""),
              url: String(message.url || ""),
            },
          },
          apiUrl,
          tabId ?? null,
        );
        if (typeof tabId === "number") scheduleCostRefresh(tabId, true);
        sendResponse({ ok: true, answer });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        sendResponse({
          ok: false,
          error: /sign in/i.test(detail) ? "Sign in to Oak" : detail,
        });
      }
    })();
    return true;
  }

  if (message.type === MSG.REMEMBER_PAGE) {
    void (async () => {
      try {
        const tabId = pinnedTabId(message.tabId, sender);
        if (tabId == null) {
          sendResponse({ ok: false, error: "No tab to remember" });
          return;
        }
        const page = await ensurePage(tabId);
        scheduleCostRefresh(tabId, true);
        sendResponse({ ok: true, page });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (message.type === MSG.FORGET_PAGE) {
    void (async () => {
      const tabId = pinnedTabId(message.tabId, sender);
      if (tabId == null) {
        sendResponse({ ok: false, error: "No tab to forget" });
        return;
      }
      await unbindPage(tabId);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === MSG.FOCUS_PAGE) {
    void (async () => {
      const tabId = pinnedTabId(message.tabId, sender);
      if (tabId == null) {
        sendResponse({ ok: false, error: "No tab to show" });
        return;
      }
      const page = await getPage(tabId);
      if (!page) {
        sendResponse({ ok: false, error: "That tab is not remembered" });
        return;
      }
      const focused = await focusChromeTab(tabId);
      sendResponse(focused ? { ok: true } : { ok: false, error: "That tab is no longer open." });
    })();
    return true;
  }

  if (message.type === MSG.REFRESH_PAGE_COST) {
    const tabId = pinnedTabId(message.tabId, sender);
    if (tabId != null) scheduleCostRefresh(tabId, true);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === MSG.START_JD_SHOT) {
    void (async () => {
      const tabId = pinnedTabId(message.tabId, sender);
      if (tabId == null) {
        sendResponse({ ok: false, error: "No tab for JD shot" });
        return;
      }
      if (jdShotTabIds.has(tabId)) {
        sendResponse({ ok: false, error: "A JD shot is already running on this tab" });
        return;
      }
      if (pipelineRunningTabIds.has(tabId)) {
        sendResponse({ ok: false, error: "Fill is running on this tab" });
        return;
      }
      if (sentTabIds.has(tabId)) {
        sendResponse({ ok: false, error: "This page is being sent" });
        return;
      }
      try {
        const token = await getAccessToken();
        if (!token) {
          sendResponse({ ok: false, error: "Sign in to Acorn in the Oak sidebar first" });
          return;
        }
        await ensurePage(tabId);
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        return;
      }
      jdShotTabIds.add(tabId);
      syncWorkKeepAlive();
      sendResponse({ ok: true });
      try {
        await runJdShot({ tabId, apiUrl: await getAthensApiUrl() });
      } finally {
        jdShotTabIds.delete(tabId);
        syncWorkKeepAlive();
        scheduleCostRefresh(tabId, true);
      }
    })();
    return true;
  }

  if (message.type === MSG.SENT_PAGE) {
    void (async () => {
      const tabId = pinnedTabId(message.tabId, sender);
      if (tabId == null) {
        sendResponse({ ok: false, error: "No tab to send" });
        return;
      }
      if (sentTabIds.has(tabId)) {
        sendResponse({ ok: false, error: "This page is already being sent" });
        return;
      }
      if (pipelineRunningTabIds.has(tabId) || jdShotTabIds.has(tabId)) {
        sendResponse({ ok: false, error: "Wait for the current step on this tab to finish" });
        return;
      }
      sentTabIds.add(tabId);
      syncWorkKeepAlive();
      try {
        const token = await getAccessToken();
        if (!token) {
          sendResponse({ ok: false, error: "Sign in to Acorn in the Oak sidebar first" });
          return;
        }
        await ensurePage(tabId);
        const result = await sendPage({ tabId, apiUrl: await getAthensApiUrl() });
        sendResponse({ ok: true, recorded: result.recorded, runId: result.runId });
        // Only after the backend has the screenshot: the page is done, so it goes.
        await unbindPage(tabId);
        await closeTabsQuietly([tabId]);
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      } finally {
        sentTabIds.delete(tabId);
        syncWorkKeepAlive();
      }
    })();
    return true;
  }

  if (message.type === "oak:reconnect-socket") {
    void connectSocket()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === MSG.START_PIPELINE) {
    void (async () => {
      const tabId = pinnedTabId(message.tabId, sender);
      if (!tabId) {
        sendResponse({ error: "No tab for pipeline" });
        return;
      }
      if (pipelineRunningTabIds.has(tabId)) {
        sendResponse({ error: "A pipeline is already running on this tab" });
        return;
      }
      if (jdShotTabIds.has(tabId) || sentTabIds.has(tabId)) {
        sendResponse({ error: "A JD shot or Sent is running on this tab" });
        return;
      }

      try {
        await ensurePage(tabId);
      } catch (err) {
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
        return;
      }

      pipelineRunningTabIds.add(tabId);
      syncWorkKeepAlive();
      sendResponse({ ok: true });

      try {
        const token = await getAccessToken();
        if (!token) {
          broadcastPipelineProgress(tabId, {
            phase: "error",
            message: "Sign in required",
            error: "Sign in to Acorn in the Oak sidebar first",
          });
          return;
        }

        const apiUrl = await getAthensApiUrl();
        await runFabPipeline({
          tabId,
          preferredFrameId: sender.tab ? (sender.frameId ?? null) : null,
          aiServerUrl: apiUrl,
          emitDomTree: (payload) => {
            getOakSocket()?.emit("dom:tree", payload);
          },
          onProgress: (progress) => {
            broadcastPipelineProgress(tabId, progress);
          },
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        broadcastPipelineProgress(tabId, {
          phase: "error",
          message: "Failed",
          error,
        });
      } finally {
        pipelineRunningTabIds.delete(tabId);
        syncWorkKeepAlive();
      }
    })();

    return true;
  }

  if (message.type === MSG.MATCH_OPTION) {
    const incoming = message.payload as MatchOptionRequest;
    const usageTabId = sender.tab?.id;
    (async () => {
      try {
        const base = await getAthensApiUrl();
        const payload: Record<string, unknown> = {
          intendedValue: incoming.intendedValue,
          options: incoming.options.filter(
            (opt): opt is string => typeof opt === "string" && opt.trim().length > 0,
          ),
        };
        if (typeof incoming.fieldLabel === "string" && incoming.fieldLabel.trim()) {
          payload.fieldLabel = incoming.fieldLabel;
        }
        if (typeof incoming.typedQuery === "string" && incoming.typedQuery.trim()) {
          payload.typedQuery = incoming.typedQuery;
        }
        const res = await fetch(`${base}/api/oak/match-option`, {
          method: "POST",
          headers: await authHeaders(usageTabId),
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => ({}))) as MatchOptionResponse;
        if (!res.ok) {
          sendResponse({
            ok: false,
            matched_option: null,
            error: data.error || `match-option failed: ${res.status}`,
          } satisfies MatchOptionResponse);
          return;
        }
        let reply: MatchOptionResponse = { ...data, ok: data.ok !== false };
        const listed = (payload.options as string[]) || [];
        let fromAnalyze: string | null = null;
        if (reply.ok && !reply.matched_option && listed.length) {
          fromAnalyze = await matchOptionViaAnalyze({
            intendedValue: String(incoming.intendedValue || ""),
            options: listed,
            fieldLabel: typeof incoming.fieldLabel === "string" ? incoming.fieldLabel : "",
            apiUrl: base,
            tabId: usageTabId ?? null,
          }).catch(() => null);
          if (fromAnalyze) {
            reply = { ...reply, matched_option: fromAnalyze, ok: true };
          }
        }
        sendResponse(reply);
      } catch (err) {
        sendResponse({
          ok: false,
          matched_option: null,
          error: err instanceof Error ? err.message : String(err),
        } satisfies MatchOptionResponse);
      }
    })();
    return true;
  }

  if (message.type === MSG.FETCH_DOM || message.type === MSG.FETCH_AND_EMIT_DOM) {
    void (async () => {
      const tabId = pinnedTabId(message.tabId, sender);
      if (!tabId) {
        sendResponse({ error: "No tab for DOM fetch" });
        return;
      }
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: MSG.FETCH_DOM });

        if (result?.error) {
          sendResponse({ error: result.error });
          return;
        }

        if (!result?.tree) {
          sendResponse({ error: "No DOM tree returned from page" });
          return;
        }

        const payload: DomTreePayload = { ...result, tabId };

        if (message.type === MSG.FETCH_AND_EMIT_DOM) {
          getOakSocket()?.emit("dom:tree", payload);
        }

        sendResponse(payload);
      } catch (err) {
        sendResponse({ error: String(err) });
      }
    })();
    return true;
  }
});
