# How the Acorn extension works

Written from the code at commit `c03b211` (extension **v1.49.0**, 2026-10-13). It covers the Chrome extension in [`acorn/extension`](../../extension), the packages it bundles, and the parts of [`acorn-backend`](../../../acorn-backend) and [`backend-core`](../../../backend-core) it talks to. Where this document disagrees with [`acorn/README.md`](../../README.md) or [`acornapi/README.md`](../../../acorn-backend/acornapi/README.md), the code wins; §15 lists the known differences.

## Contents

1. [What Acorn is](#1-what-acorn-is)
2. [The big picture](#2-the-big-picture)
3. [Repository map](#3-repository-map)
4. [Extension runtime](#4-extension-runtime)
5. [Sign-in, sessions, and the socket](#5-sign-in-sessions-and-the-socket)
6. [Per-tab state](#6-per-tab-state)
7. [Reading a page](#7-reading-a-page)
8. [The Fill pipeline](#8-the-fill-pipeline)
9. [Executing one plan step inside the page](#9-executing-one-plan-step-inside-the-page)
10. [Run: the multi-page orchestrator](#10-run-the-multi-page-orchestrator)
11. [Résumés, cover letters, and file formats](#11-résumés-cover-letters-and-file-formats)
12. [The backend (acorn-backend)](#12-the-backend-acorn-backend)
13. [The models and what each one decides](#13-the-models-and-what-each-one-decides)
14. [Data, storage, and privacy](#14-data-storage-and-privacy)
15. [Docs vs. code: what is out of date](#15-docs-vs-code-what-is-out-of-date)
16. [Developing and debugging](#16-developing-and-debugging)
17. [Glossary](#17-glossary)
18. [Where to look](#18-where-to-look)
19. [The agent Run (acorn-agent)](#19-the-agent-run-acorn-agent)

---

## 1. What Acorn is

Acorn is a Chrome MV3 extension with a native side panel that applies to jobs on any website. The main action is **Run**: one click that

1. reads the page in the active tab,
2. picks a résumé from the user's Library for that posting,
3. opens the application (clicks Apply),
4. fills each page from the user's Acorn profile (text, dropdowns, radios, checkboxes, uploads),
5. signs in to, creates, or recovers the site's account when the site requires one,
6. reads emailed verification codes or links from the user's connected Gmail,
7. clicks Next / Submit, fixes the fields the site rejects, and
8. stops on the confirmation page (or on a clear reason why it could not finish).

Four design rules run through the whole codebase:

- **No per-site rules.** Nothing matches vendor class names, hostnames, ids, or button wording. Code reads page _structure_ (ARIA roles, native inputs, dialogs, layout); every _judgment_ ("what page is this?", "which control moves forward?", "which option is the answer?") is a model decision. (See also the memory note "No hardcoding in the agent".)
- **Two models with separate jobs.** A text model writes (plans, free-text answers, job-description extraction). A decision model, TypeSafe **Jev**, only chooses among things that already exist and returns probabilities. The backend wraps Jev as the **SelectorGateway**.
- **Bring your own key.** Every model call uses the OpenRouter API key saved on the user's Acorn profile. The server has no AI key of its own.
- **The Chrome tab id is the session key.** All state is per tab, and several tabs can run at once.

---

## 2. The big picture

```text
┌───────────────────────────────── Chrome ──────────────────────────────────┐
│                                                                           │
│  Side panel  (React + sid-ui, sidebar.html)                               │
│    Jobs · Ask · Support · Logs                                            │
│        │  chrome.runtime.sendMessage        ▲  storage.onChanged,         │
│        │  port "acorn-sidebar" (keep-alive) │  PIPELINE_PROGRESS,         │
│        ▼                                    │  OPERATOR_NOTICE            │
│  Service worker  (src/background.ts)  — owns the Socket.IO socket         │
│    message router · Run orchestrator · Fill pipeline · résumé            │
│    recommend/generate · usage ledger · capture sink · dialog watcher      │
│        │  chrome.tabs.sendMessage(tab, msg, {frameId})                    │
│        │  chrome.debugger (browser dialogs, focus emulation)              │
│        ▼                                                                  │
│  Content script  (src/content/index.ts) — one per frame, all frames       │
│    serialize DOM · list fields · run plan steps · click · probe ·         │
│    drift repair · leftover dropdowns · scopes · selection Q&A chip        │
└──────────┬─────────────────────────────────────────────┬──────────────────┘
           │ HTTPS  /acorn/*                              │ Socket.IO
           │ Authorization: Bearer <session token>        │ path /acorn/socket.io
           │ X-Acorn-Client: extension/<version>          │ auth.token = session token
           │ X-Acorn-Tab: <per-tab uuid>                  │
           ▼                                              ▼
┌──────────── acorn-backend (Go) — 127.0.0.1:8083 / acornapi.remotepairnet.net ───┐
│ acornapi   routes, sessions, usage push, capture   gateway  per-account rooms   │
│ acorn      planner · fast planner · refill · writer · Q&A · JD extract          │
│ selector   SelectorGateway: every "pick one" decision goes to Jev               │
│ mailcode / mailbox   Gmail search for emailed codes and links                   │
│ profile · resume (Library, recommend, generate) · aiusage · debugtrace · support │
└──────┬──────────────────────────┬──────────────────────────────┬────────────────┘
       │                          │                              │
  MongoDB "AcornDB"         OpenRouter (account's key)       Gmail API
  acorn_* collections       chat:      openai/gpt-6-luna     (connected mailbox,
                            decisions: typesafe/jev-1.13      refresh token)
```

The other apps around it:

- **acorn-frontend** (Next.js, `localhost:6005` / `acorn.remotepairnet.net`): where the user signs up, edits the profile (including the OpenRouter key, the **extension password**, and the **default account password** for job sites), uploads Library résumés and cover letters, and connects Gmail. It also serves `GET /api/extension/latest`, which the sidebar uses for its update notice.
- **acorn-admin** (`:6010`): the support console. It reads support claims (with the captured session), and can open a support session as a user.

---

## 3. Repository map

| Path                                                                       | What it is                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`acorn/extension`](../../extension)                                       | The extension (workspace `acorn-extension`). Version lives only in `package.json`.                 |
| `acorn/extension/src/background.ts`, `src/background/`                     | Service worker: startup, alarms, tab lifecycle, message router, socket, capture sink.              |
| `acorn/extension/src/content/`                                             | Content script: DOM serializer, field scan, plan-step runner, click, scope, probe, drift repair.   |
| `acorn/extension/src/content/agents/`                                      | How each kind of control is filled: text, selects, comboboxes, radios/checkboxes, uploads.         |
| `acorn/extension/src/pipeline/`                                            | Fill pipeline, Run orchestrator, résumé recommend/generate, API clients (`pipeline/api/`).         |
| `acorn/extension/src/sidebar/`                                             | Side panel React app.                                                                              |
| `acorn/extension/src/tab-*-session.ts`, `storage-lock.ts`                  | Per-tab state in `chrome.storage.session`, IndexedDB log.                                          |
| [`acorn/packages/shared`](../../packages/shared) (`@acorn/shared`)         | Contracts shared by extension and tests: plan types, plan runner, trees, field issues, run types.  |
| [`acorn/packages/acorn-face`](../../packages/acorn-face) (`@acorn/face`)   | The animated mascot face (canvas, worker-rendered). UI only.                                       |
| [`packages/support-chat`](../../../packages/support-chat)                  | Support-claim UI and API paths shared by the extension and the site.                               |
| [`packages/app-theme`](../../../packages/app-theme)                        | `AppTheme` wrapper around `sid-ui`.                                                                |
| [`acorn-backend/cmd/server`](../../../acorn-backend/cmd/server)            | `main.go` wires stores and mounts `acornapi`; `routes.go` adds `/health` and CORS.                 |
| [`acorn-backend/acornapi`](../../../acorn-backend/acornapi)                | HTTP handlers for every `/acorn/*` route; `gateway/` is the Socket.IO server.                      |
| [`acorn-backend/acorn`](../../../acorn-backend/acorn)                      | The planning "brain": full planner, fast planner, refill, writer, Q&A, JD extraction, prompts.     |
| [`acorn-backend/selector`](../../../acorn-backend/selector)                | SelectorGateway: Jev questions for options, pages, accounts, dialogs, mail, diagnosis.             |
| [`acorn-backend/mailcode`](../../../acorn-backend/mailcode), `mailbox`     | Finding an emailed code/link; Gmail OAuth and API.                                                 |
| `acorn-backend/profile`, `resume`, `account`                               | Profile document, résumé Library/recommend/generate, accounts and sessions.                        |
| `acorn-backend/aiusage`, `debugtrace`, `support`, `supportaccess`, `admin` | Usage metering, process capture, support claims, support sign-in, admin console.                   |
| [`backend-core`](../../../backend-core)                                    | Shared Go: `config` (model ids, URLs), `openai` (OpenRouter client), `jev` (decision client), etc. |
| [`tests/e2e/mock-apply`](../../../tests/e2e/mock-apply)                    | Headless end-to-end test of the real extension on a local multi-step application site.             |

---

## 4. Extension runtime

### 4.1 Manifest and build

[`manifest.json`](../../extension/manifest.json) declares:

| Permission             | Why                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `sidePanel`            | The UI is a native side panel; the toolbar icon opens it (`setPanelBehavior({ openPanelOnActionClick })`). |
| `storage`              | `chrome.storage.local` (session, settings) and `chrome.storage.session` (per-tab state).                   |
| `unlimitedStorage`     | The per-tab log lives in IndexedDB with no cap.                                                            |
| `scripting`            | Re-inject the content script into open tabs and new navigations; full-page screenshot helpers.             |
| `webNavigation`        | List a tab's frames, watch navigations (frame reloads, SPA history changes).                               |
| `alarms`               | Keep the MV3 service worker alive while the panel is open or work is in flight.                            |
| `debugger`             | Answer the browser's own `alert/confirm/prompt/beforeunload` dialogs during Run and emulate page focus.    |
| `activeTab`            | Capture the visible tab for support screenshots.                                                           |
| `<all_urls>` host perm | The content script runs on every site; the API and site hosts are listed explicitly too.                   |

The content script is declared for `<all_urls>` with `all_frames`, `match_about_blank`, and `match_origin_as_fallback`, at `document_idle`. Because a declared content script does not reach tabs opened before install and some SPA navigations, the worker also injects it programmatically ([`inject-content.ts`](../../extension/src/inject-content.ts)) on `webNavigation.onCommitted`, `onHistoryStateUpdated`, `onInstalled`, and at worker start into every open tab (skipping `chrome://`, the Web Store, etc.). A boot flag on `window` (`__acornContentBoot`) keeps a frame from initialising twice. **Boot is made to survive its own failures:** the message listener is registered first and the other startup work (document claim, selection chip, support handoff) runs after it, each step caught and traced (`boot:error`), so one failing step (a page's content policy refusing what the chip draws) cannot leave a frame with no listener. The window flag is a liveness check (`() => Boolean(chrome.runtime?.id)`), not a bare `true`: after an extension reload an earlier script stays in the page but cut off from the extension, and a flag that only said "started" would stop the new script from starting there. Every injection returns its result (frames reached, or the error) and a failure is written to the tab's log (`inject:error`); it is never swallowed.

Build ([`vite.config.ts`](../../extension/vite.config.ts)): Vite + `@crxjs/vite-plugin`. The version is read from `package.json`, written into the built manifest, exposed as `import.meta.env.VITE_ACORN_VERSION`, and printed on every build. `VITE_*` settings come from `acorn/.env`:

| Variable                        | Effect                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_ACORN_API_URL`            | API origin. Default from `@acorn/shared/api`: `http://127.0.0.1:8083` in development, `https://acornapi.remotepairnet.net` otherwise.        |
| `VITE_ACORN_WEB_URL`            | Site origin. Default `http://localhost:6005` / `https://acorn.remotepairnet.net`. Used for the update check and support handoff.             |
| `VITE_ACORN_AGENT_URL`          | Where acorn-agent runs (§19). Default `http://127.0.0.1:8090` in every build: the server reads the applicant's files from the same machine.  |
| `VITE_ACORN_DEBUG`              | Development builds only: always use the build's API URL (ignore the Settings value) and (no longer reports capture uploads: there are none). |
| `VITE_ACORN_AUTO_FOCUS_SECONDS` | Seconds each run tab stays in front under Auto-Focus. The code default is **4** (`AUTO_FOCUS_DEFAULT_SECONDS`); `.env.example` says 2.       |

`bun run dev:acorn` watch-builds to `acorn/extension/dist` in development mode (old hashed files are kept so a run in progress keeps its content script); `bun run build:acorn` is the production build. File names carry no hash in either build (`assets/[name].js`): an extension that is already running keeps asking for the names of the build it was loaded from, and a rebuild that renamed them left every page opened afterwards with no content script until the extension was reloaded.

### 4.2 Service worker

[`background.ts`](../../extension/src/background.ts) does this at start:

- Creates the `acorn-socket-keep-alive` alarm (every 30 s). On each tick it pings `chrome.runtime.getPlatformInfo()` while a side panel port is open, and redials the socket if it is down. A second alarm, `acorn-work-keep-alive`, runs only while any tab has a fill, run, or generate in flight ([`work-state.ts`](../../extension/src/background/work-state.ts)).
- Accepts the side panel's long-lived port (`acorn-sidebar`), pushes socket status over it, and dials the socket.
- Connects the socket, redials immediately when the browser comes back `online`.
- Enables "open side panel on toolbar click", binds content-script injection and the Auto-Focus setting, and injects into open tabs.
- Drops per-tab logs of tabs that no longer exist.
- Tab lifecycle: `tabs.onRemoved` unbinds the tab's job, custom binding, pipeline progress, and log. `tabs.onReplaced` (prerender swaps) re-keys every per-tab map and in-memory set from the old id to the new one. `tabs.onUpdated` refreshes a remembered tab's title/URL/favicon.
- `storage.onChanged` on `acornApiUrl` or `acornSession` reconnects the socket (debounced 200 ms).
- `runtime.onMessage` → [`message-router.ts`](../../extension/src/background/message-router.ts).

Messages the router handles (constants in [`types.ts`](../../extension/src/types.ts) `MSG`):

| Message                                              | Sender → handler                              | What it does                                                                   |
| ---------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| `acorn:start-run`, `acorn:stop-run`                  | sidebar → `messages/run.ts`                   | Start Run on a tab (optionally `continueRun`, `stopBeforeSubmit`); abort it.   |
| `acorn:start-pipeline`                               | sidebar → `messages/pipeline.ts`              | One Fill or Refill pass on the tab (`source` fill/custom, `mode` fill/refill). |
| `acorn:fetch-dom`, `acorn:fetch-and-emit-dom`        | sidebar → `messages/pipeline.ts`              | Serialize the tab's DOM; optionally emit `dom:tree` on the socket.             |
| `acorn:start-custom-generate` / `-recommend`         | sidebar → `messages/generate.ts`              | Generate or recommend a résumé for a remembered tab.                           |
| `acorn:start-job-generate` / `-recommend`            | sidebar → `messages/generate.ts`              | Same for a Worker Pool job bound to the tab.                                   |
| `acorn:remember/forget/focus-custom-tab`             | sidebar → `messages/custom-tabs.ts`           | Bind / unbind (and close) / focus a remembered tab.                            |
| `acorn:open-worker-job`, `acorn:get-tab-job`         | → `messages/worker-jobs.ts`                   | Focus or open a job's apply URL and bind it to the tab; read a tab's job.      |
| `acorn:match-option`                                 | content → `messages/match-option.ts`          | `POST /acorn/match-option` for a content-script option decision.               |
| `acorn:estimate-option`                              | content → `messages/estimate-option.ts`       | Ask the writer (`/acorn/qa`) for a short answer to type into a long dropdown.  |
| `acorn:selection-qa`                                 | content → `messages/selection-qa.ts`          | Answer selected text on the page via `/acorn/qa`.                              |
| `acorn:support-handoff-relay`                        | content (Acorn site only) → `support-session` | Redeem a support sign-in code.                                                 |
| `acorn:submit-support-claim`                         | sidebar → `messages/support-claim.ts`         | Full-page screenshot + notes → new claim or follow-up message.                 |
| `acorn:refresh-tab-usage`                            | sidebar → `tab-usage-store.ts`                | Reconcile a tab's AI usage with `GET /acorn/ai-usage`.                         |
| `acorn:auth-status`, `acorn:auth-signin`, `-signout` | sidebar → `messages/auth.ts`                  | Session state, sign in with email + extension password, sign out.              |
| `acorn:socket-status`, `acorn:reconnect-socket`      | sidebar → `messages/auth.ts`                  | Socket state; force a dial.                                                    |
| `acorn:page-delay`                                   | content → router                              | Answer after `ms` (≤ 60 s): a timer for hidden tabs (§9.7).                    |
| `acorn:debug-trace`                                  | content → `debug-trace-sink.ts`               | A page trace event: written to the tab's local log (it is not uploaded).       |

Handlers that start work reply `{ ok: true }` immediately and report progress asynchronously through `broadcastPipelineProgress(tabId, progress)` ([`socket-connection.ts`](../../extension/src/background/socket-connection.ts)), which:

1. emits `pipeline:progress` on the socket (the server relays it to the account's other clients),
2. merges it into `acornTabPipelines` in `chrome.storage.session` (serialized per tab), and
3. sends `acorn:pipeline-progress` to the side panel.

### 4.3 Content script

[`content/index.ts`](../../extension/src/content/index.ts) runs in every frame. On boot it marks its document as handled by its own script (`data-acorn-frame`, so a parent frame never serializes or clicks into it — §7.1), sets up the selection Q&A chip, and (on the Acorn site only) the support handoff listener. The claim is made again whenever the page replaces the frame's root element (`document.open`/`write` gives it a new one, and the old claim goes with the old root), so the parent does not start reading a frame that answers for itself.

Two predicates decide whether a frame answers a message:

- **form frame**: the top frame, a child frame with ≥ 2 fillable controls, or a frame whose own page (outside any dialog laid over it) has ≥ 1 visible field (an email-first sign-in embedded under a consent banner);
- **run frame**: a form frame, or any frame holding elements the run already numbered (a posting inside an embedded job-board frame).

A non-matching frame replies `{ skipped: true }` (never holding the channel open), so the worker can ask every frame and keep the one that answers.

Every message that touches form controls goes through one promise queue (`runExclusive`), so a slow step can never overlap the next step or the leftover pass.

| Message                                                                 | Content-side work                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acorn:fetch-dom`                                                       | Wait (≤ 5 s) for the form to hydrate, then serialize the DOM; optionally include field issues, form fields, scope. The page's HTML never leaves the page. The reply says how long each part took (`timings`). |
| `acorn:plan-step`                                                       | Run one plan step (§9). The page gives up at 115 s so its own error reaches the worker before the 120 s channel timeout.                                                                                      |
| `acorn:fill-leftover-combos`                                            | Answer dropdowns no step answered (§9.5), stopping new work at the given deadline; a refill's pass (`flagged`) answers only blank ones the page asks for.                                                     |
| `acorn:collect-choices`                                                 | List planned choice steps that still need an exact option label (§8, choice batch).                                                                                                                           |
| `acorn:scan-field-issues`                                               | After the page goes quiet, re-read what it flags (Refill's after-check).                                                                                                                                      |
| `acorn:repair-drift`                                                    | Put back answers the page cleared since a timestamp (§9.6).                                                                                                                                                   |
| `acorn:page-probe`                                                      | Cheap page fingerprint for settle loops (§7.8).                                                                                                                                                               |
| `acorn:click-control`                                                   | Press a control by node id (the click lands 60 ms after the reply, so a navigation cannot swallow the answer).                                                                                                |
| `acorn:scope-census` / `-state` / `-end`                                | Track what a requirement's click opens inside the page (§10.9).                                                                                                                                               |
| `acorn:highlight`, `-clear-highlight`, `get-content`, `execute-actions` | Socket-relayed inspection and low-level actions (§5.4).                                                                                                                                                       |

### 4.4 Side panel

The panel is a React app ([`sidebar/main.tsx`](../../extension/src/sidebar/main.tsx) → [`SidebarApp.tsx`](../../extension/src/sidebar/SidebarApp.tsx)) built from `sid-ui`. Signed out, it shows the sign-in card ([`SignInCard.tsx`](../../extension/src/sidebar/SignInCard.tsx)). Signed in:

- **Header**: the live Acorn Face, the active tab's job or host, a busy-workers count, and an account menu (Acorn Face guide, Settings, Report, Sign out / End support session). The avatar dot is the socket state. The Report dialog closes and discards its notes when the active browser tab changes, and starts empty each time it opens.
- **Nav** (`PillNav`, hash routed): **Jobs**, **Ask**, **Support**, **Logs**.
- **Jobs**: the **Now card** for the active tab, the **Activity** feed, the **Auto-Focus** switch, and the tab's AI usage list. **Activity** ([`ActivityFeed.tsx`](../../extension/src/sidebar/ActivityFeed.tsx)) tells the latest run step by step in plain words — "Read the page · 493 elements", "Read the page with the AI · 3.2 s", "Chose the résumé: Data Engineer", "Clicked Submit Application", "Filled the form · 15 done", "Wait for the applicant", "Found the site's email" — with a spinner on what is running and a warning on a call that got no answer. It is a view over the tab's local log built by [`buildActivityFeed`](../../extension/src/activity-feed.ts) (nothing is stored twice); each row opens to its facts and the log entries behind it. The newest 14 rows show, the rest behind "Show all". **The feed accounts for the whole run's time.** Rows are laid out on the clock in the order things happened (whatever order the log was written in), each with when it began (`+12.3 s` from the run's first step) and how long it took; what happened _inside_ the form fill (the plan call, the writer's answers, dropdown picks) is nested under it, so no duration is counted twice; a click owns the wait for the page to answer it; time between steps that no step accounts for is its own **Waiting** row; and the run's last row opens to **where the time went** — every phase the run timed plus a "Not measured" remainder, adding up to the run's total. On the Jobs tab the Now card shows **Run** (or "Run again"), **Continue** after a stopped run, and **Stop** while running. Fill page, Refill flagged fields, Generate, and Recommend are wired but hidden there (`JOBS_NOW_CARD_RUN_ONLY = true` in [`sidebar-work-state.ts`](../../extension/src/sidebar/sidebar-work-state.ts)). While a run works, the card shows its timer, page/refill counters, the stop reason when it fails, the emails being read for a code (with Jev's probabilities), and, on account steps, which default password is being used.
- **Ask**: Q&A with the same writer as text-field filling (`POST /acorn/qa`). Selecting ≥ 8 characters on any page also shows an in-page Acorn chip that answers the selection and offers Copy.
- **Support**: the user's claims, threads, and unread replies (pushed over the socket).
- **Logs**: the per-tab log (IndexedDB `acorn-tab-log`), grouped by run: DOM tree stats, compressed and meta trees, analysis, **every backend call** (request, answer, status and latency, or why it got no answer), the run's **decisions** and what they rested on (`decision` entries: why it clicked, waited, or stopped), plan, every trace event, and errors that were caught. Each entry carries its level, run, step, page, duration, and a group that links a call's request, answer and decision. Filter by view (All / Problems / Run / AI / Trees), search titles and contents, copy, or **Download** the whole log (not only what the view or search shows) as one compressed zip (each entry deflated; typically a tenth of the size) that opens with `00-summary.json` (each run's outcome, reason, durations per phase) and `01-index.json`. It stays in the browser; see §12.7.
- **Settings drawer**: socket state, Acorn version, and the API URL (saved to `chrome.storage.local`; ignored by debug builds).
- **Update dialog**: on open, the panel asks `GET <site>/api/extension/latest` once; when its version is newer than `VITE_ACORN_VERSION`, a dialog links to the download.
- **Notices**: expected failures and results are toasts (`pushAcornNotice` / `broadcastOperatorNotice`). A notice with a `tabId` shows only while that tab is focused.

The panel never holds work state of its own. It reads `chrome.storage.session` on open, follows `storage.onChanged` and `acorn:pipeline-progress`, and sends start/stop messages. Closing the panel does not stop a run.

---

## 5. Sign-in, sessions, and the socket

### 5.1 Extension sign-in

```text
Side panel                    Service worker                       acorn-backend
──────────                    ──────────────                       ─────────────
email + extension password ─▶ acorn:auth-signin ─▶ POST /acorn/auth/extension/signin {email, password}
                                                     • find account by email (or by profile email)
                                                     • profile.extensionPassword must be set and equal
                                                       (constant-time compare)
                                                     • StartSession → random token, stored as SHA-256 hash,
                                                       30-day TTL (acorn_sessions)
                              ◀── { token, session{username, displayName, profileId} }
                              chrome.storage.local.acornSession = {accessToken, …, expiresAt: ""}
                              chrome.storage.local.acornApiUrl  = the base used
                              connect socket
◀── signed in (toast)
```

- The **extension password** is a separate secret the user sets on the Acorn profile (site → Account tab). It is not the website password. The signed-in email may be the account email or the profile email.
- Signing out calls `POST /acorn/auth/signout` (revokes the session) and clears local storage; the website session is untouched.
- The API URL is the Settings value, else the build default; retired hosts are ignored ([`acorn-auth.ts`](../../extension/src/auth/acorn-auth.ts)).
- Server side, `account.Store.Session` looks up the token's SHA-256 hash, caches a checked session for 30 s, and rejects expired or deactivated accounts. The extension keeps `expiresAt: ""` for normal sessions, so it learns about expiry from a 401 or a socket auth error ("Session expired").

### 5.2 Support sessions

An admin in acorn-admin can start a **support session** for a user. The flow uses `window.postMessage` on the Acorn site only ([`content/support-handoff.ts`](../../extension/src/content/support-handoff.ts), [`@acorn/shared/api`](../../packages/shared/api.ts)):

1. The site page posts `acorn:extension-ping`; the content script answers `acorn:extension-hello` with the account it is signed in as.
2. If that is not the support session, the page posts `acorn:support-handoff` with a one-time code.
3. The content script relays it to the worker, which accepts it only from the top frame of a known Acorn site origin, redeems it at `POST /acorn/auth/support/redeem`, stores the user's own session as `acornSessionBeforeSupport`, and switches to the support session (which has an `expiresAt`).
4. Signing out of a support session (or its expiry) restores the user's own session.

A support session cannot delete the account; every model call it makes is recorded with `supportBy`.

### 5.3 Every API call

`authHeaders(tabId)` adds:

- `Authorization: Bearer <token>`,
- `X-Acorn-Client: extension/<version>` (usage stats tell the extension from the site),
- `X-Acorn-Tab: <uuid>` when the call is about a tab. The UUID is created per Chrome tab and kept in `chrome.storage.session` (`acornTabUsageKeys`); it survives panel reloads but not a browser restart. The backend uses it to file AI usage and process capture per tab.

### 5.4 The Socket.IO connection

[`acorn-socket.ts`](../../extension/src/acorn-socket.ts) owns one socket per worker:

- Origin = the API host; path `/acorn/socket.io`; `auth: { token }` in the handshake (query-string tokens are never accepted because URLs reach proxy logs); query `type=extension`.
- Transports websocket first, then long-poll; socket.io reconnection with 1 s → 30 s backoff and ±50 % jitter; 20 s connect timeout. When the server refuses the token or kicks the socket (cases socket.io does not retry), the extension schedules its own redial with the same backoff, reading a fresh token.
- A connection notice appears only for outages longer than 5 s ("Reconnecting…", then "Reconnected"), or "Session expired" for auth errors.

The server side ([`gateway/gateway.go`](../../../acorn-backend/acornapi/gateway/gateway.go)) authenticates the handshake token as an Acorn session and puts the socket in the room `acorn:acct:<accountId>`. Everything stays inside that room, so one account can never see or drive another's browser.

| Event                                                                      | Direction                                   | Purpose                                                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ai-usage:recorded`                                                        | server → extension                          | `{ tab, entry }` for every model call recorded; the worker appends it to that tab's usage ledger.                              |
| `support:message`, `support:claim`                                         | server → extension                          | A claim changed; the worker forwards `acorn:support-claims-changed` to the panel.                                              |
| `pipeline:progress`                                                        | extension → server → room                   | Relayed to the account's other clients.                                                                                        |
| `dom:tree`                                                                 | extension → server → room                   | A serialized tree, emitted only by the sidebar's explicit fetch-and-emit (never during Run); relayed with node counts.         |
| `clients:update`, `connected`                                              | server → room                               | Who is connected.                                                                                                              |
| `dom:highlight`, `dom:get-content`, `dom:execute-actions`, `dom:plan-step` | another client → server → extension (acked) | Remote inspection and actions on a tab, relayed only to an extension socket of the same account (timeouts 15 s / 60 s / 45 s). |

The relay events are the remains of the original "UI board" that drove the extension remotely; the current Fill and Run pipelines run entirely inside the extension and call the backend over HTTP.

### 5.5 Keeping MV3 alive

A service worker may be stopped when idle. Acorn keeps it running with: the side panel's port (`acorn-sidebar`, re-attached if it drops), the 30 s keep-alive alarm while the panel is open, and the work alarm while any tab works. The socket state shown in the panel comes from the port plus a 3 s poll.

---

## 6. Per-tab state

Everything that belongs to a tab is keyed by its tab id. Writes to a shared map go through a per-key promise lock ([`storage-lock.ts`](../../extension/src/storage-lock.ts)).

| Store                                                                           | Key                                                                                                     | Holds                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chrome.storage.local`                                                          | `acornSession`, `acornSessionBeforeSupport`, `acornApiUrl`                                              | Sign-in and API URL.                                                                                                                                         |
| `chrome.storage.local`                                                          | `acornAutoFocus`, `acornStopBeforeSubmit`                                                               | Run switches (per browser).                                                                                                                                  |
| `chrome.storage.session`                                                        | `acornTabPipelines`                                                                                     | Each tab's latest `PipelineProgress` (phase, message, plan, steps, run state). The panel renders this.                                                       |
| `chrome.storage.session`                                                        | `acornCustomTabs`                                                                                       | "Remembered" tabs: résumé mode, recommended Library résumé (+ top 3), generation ids, status, checkpoint.                                                    |
| `chrome.storage.session`                                                        | `acornTabJobs`                                                                                          | Worker Pool job bound to a tab (job id, apply URL, résumé stack).                                                                                            |
| `chrome.storage.session`                                                        | `acornJobGenerates`                                                                                     | Per-job generate/recommend state.                                                                                                                            |
| `chrome.storage.session`                                                        | `acornRunCheckpoints`                                                                                   | Where a stopped run left off (for Continue).                                                                                                                 |
| `chrome.storage.session`                                                        | `acornTabUsageKeys`, `acornTabUsage:<key>`                                                              | Per-tab usage key and the usage ledger view.                                                                                                                 |
| IndexedDB `acorn-tab-log`                                                       | entries indexed by tab                                                                                  | The Logs tab. Cleared when the tab closes; moved to the tab a run goes on in. Keeps each tab's last 5 runs and at most 50 MB of text, oldest runs first out. |
| IndexedDB `acorn-file-cache`                                                    | account + file address                                                                                  | Résumé and cover-letter files with their version tag (ETag); at most 200 MB, the oldest-used dropped.                                                        |
| Worker memory ([`work-state.ts`](../../extension/src/background/work-state.ts)) | `pipelineRunningTabIds`, `runTabIds`, `customGenerateTabIds`, `jobGenerateJobIds`, run stop controllers | What is in flight right now.                                                                                                                                 |

Rules ([`policy-acorn.md`](../../policy-acorn.md) §1):

- One tab runs one thing at a time: a Fill/Run and a Generate/Recommend on the same tab refuse each other. Different tabs run in parallel.
- A Run can move to a tab it opened (an Apply that opens a new tab). The run "claims" that tab: progress is emitted to every claimed tab, Stop works from any of them, and the job/custom bindings are re-keyed to it.
- When a click (not a requirement's detour, which comes back) opens the application in a new tab, the run goes on there and closes the tab it left: the new tab comes to the front if the old one was in front, and the old tab's log and the run's own log move to the new tab ([`moveTabLog`](../../extension/src/tab-log-session.ts)), so nothing is lost when it closes.
- The run follows its tab when Chrome swaps it for another (`tabs.onReplaced`, e.g. a page it had ready took its place). When the site closes the run's tab, the run goes on in a tab that one opened, else in its own latest tab still open ([`successorTab`](../../extension/src/pipeline/run-tabs.ts)); whatever was in flight on the old tab is dropped and the new one is read afresh. With no tab left the run stops with "The tab the application was in closed" (`tab_closed`).
- The extension never opens tabs of its own except a Worker Pool job's apply URL; emailed links open in the run's own tab.

---

## 7. Reading a page

### 7.1 Node ids

Each frame stamps elements it serializes with a per-frame attribute `data-acorn-id-<8 random hex>="<n>"` ([`acorn-id.ts`](../../extension/src/content/acorn-id.ts)). Ids are reassigned on every serialization, and old stamps are removed first, so a stale id can never point at a new element. Because each frame has its own attribute name, a parent frame and a same-origin child it reads can number elements at the same time without clobbering each other. A same-origin child frame that runs its own content script is never read by its parent (it answers for itself, in its own realm); a child without a script (a blank widget frame) is read as part of the parent. **Elements of a frame this frame reads are checked across documents:** a same-origin child frame with no script of its own is read by its parent, and its elements are built from that frame's own `HTMLInputElement`, `Element`, …, so a plain `instanceof` is false for them. Every DOM class check in `content/` goes through [`isA`](../../extension/src/content/realm.ts) (`instanceof` in this realm, else in the realm that owns the value). Without it, a form in such a frame read as no fields, refused a fill ("Unsupported fill target"), lost its labels' text and was never clicked ("Control not found").

### 7.2 The DOM serializer

[`dom-serializer.ts`](../../extension/src/content/dom-serializer.ts) turns the live DOM into a `DomNode` tree:

- Drops `script/style/noscript`, media (`svg`, `img`, `canvas`, `video`…), and head noise. A picture the page makes clickable by itself (a bare icon image) is kept as a control. A posting read also drops hidden subtrees.
- **Clickable by look.** An element whose markup says nothing (no link, button, role, `onclick`, `tabindex`) but over which the cursor turns to a pointer is a control: the page's own statement of what is clickable. Only the outermost such element counts (a cursor is inherited), one that holds other controls is a container, and text over 80 characters is a block of copy; it is marked `acorn-pointer` and never flattened away. Computed style is the signal, so no class name or wording is involved.
- A clickable element that holds a picture is told apart by what the picture shows: `acorn-icon` is its alt text, title, SVG title, or file name (`next_arrow.png` → "next arrow"). `alt` is kept as an attribute.
- **Flattens** empty layout wrappers (`div`, `span`, `section`… with no text, no role, no `aria-*`, not interactive): their children move up.
- Walks open shadow roots and same-origin iframes it is allowed to read.
- Caps: depth 32, 120 children per node, 600 for option lists (`select`, `listbox`, runs of `role=option`), text 120 chars (4,000 for a posting read), first 3 class tokens.
- Keeps these attributes: `href src for type role name aria-label aria-labelledby aria-describedby aria-required aria-invalid aria-checked autocomplete placeholder value data-automation-id data-fkit-id selected checked`, plus `disabled` and an iframe's `title`. A custom element wrapping a native control gets the inner control's role.
- The live `value` of inputs/textareas is included, except **password boxes, whose value becomes `(hidden)`**.
- Any element that is not rendered (`display:none`, `visibility:hidden`, here or above) is marked `acorn-hidden`, and the page's readable text sent to the decision model leaves those subtrees out ([`withoutHidden`](../../packages/shared/tree-export.ts)): a dialog the page keeps in its markup until it is needed (a security-code prompt) is not read as the page's state. For clickable controls it also records layers: `acorn-hidden` (not rendered), `acorn-dialog` (the open dialog it sits in), `acorn-covered` (an open dialog is over it; checked with a hit test at its centre). See [`page-layers.ts`](../../extension/src/content/page-layers.ts).

### 7.3 Choosing the frame

[`fetchDomFromTab`](../../extension/src/pipeline/fetch-dom.ts) sends `acorn:fetch-dom` to the frame the run already reads (kept if it still holds a form), otherwise to every frame of the tab in parallel. Each frame waits up to 5 s for fields to appear (SPAs hydrate late) and reports `formScore` (fillable controls) and `pageScore` (visible fields of its own page outside dialogs). The winner sorts by `pageScore`, then `formScore`, then the preferred frame; with no form anywhere the main document wins. If no frame answers, the error lists each frame's outcome and suggests reloading the extension and the page. **With no form anywhere, the page is the frame that carries its copy**, not always the main document: frames are ranked by visible text (a hidden subtree counts for nothing), the main document winning only a tie. A frame with no form still answers when it carries at least 120 characters of visible copy (`MIN_FRAME_COPY_CHARS`; a captcha or widget frame says a few words and is skipped as before), and what the other frames that answered say joins the page's text for the decision model (`otherFrames`, combined by `combineFrameTexts`, the frame with most copy first; their node ids are never used). A careers portal drawn in a frame of its shell says "Your application was submitted successfully" in the frame: read from the shell alone, the page was an empty shell and the run stopped with no forward control after a successful Submit.

A **posting read** ([`fetch-posting.ts`](../../extension/src/pipeline/fetch-posting.ts)) asks every frame at once with a 1.5 s timeout and takes the one with the most visible text.

### 7.4 Trees sent to models

| Name             | Built by                                                                | Used for                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Planner tree** | [`formatPlannerTree`](../../packages/shared/planner-tree.ts)            | The tree `/acorn/ai-analyze` reads. One line per node `tag[id] attrs "text"`, bare wrappers folded, class tokens on controls only, option lists > 12 shortened to head 6 + "… N more options …" + tail 3. |
| **Pure tree**    | [`formatAnalyzeTrees().pureTree`](../../packages/shared/tree-export.ts) | Full indented tree with every node's `detail` (attrs + classes). Used for page text (Run reads, Custom JD extract).                                                                                       |
| **Meta tree**    | `formatAnalyzeTrees().metaTree`                                         | Raw attrs/classes per id; kept in the local Logs panel only, never sent.                                                                                                                                  |

### 7.5 The field list (fast plan input)

[`content/form-fields.ts`](../../extension/src/content/form-fields.ts) lists up to 150 fields as `FormField` ([`@acorn/shared/form-fields`](../../packages/shared/form-fields.ts)):

- `kind`: `text`, `textarea`, `select`, `radio`, `checkbox` (group), `toggle` (single box/switch), `buttons` (2–6 short option buttons), `file`.
- `label` (the question, read structurally: `aria-labelledby`, `for` labels with reused-id protection, wrapping labels, legends, the title inside the field's own wrapper), `section` (the form section heading, e.g. "References"), `inputType`, `autocomplete`, `placeholder`, `name`, `maxLength`, `notes` (text after the field such as "0/300"), `required`, `options`, `accept` (file inputs).
- Hidden proxy inputs next to visible Yes/No buttons become one `buttons` field. Plain buttons with no state of their own count as one question's answers only when each has words of its own, no two say the same thing, and all are drawn alike (same tag, type, role, and classes) — [`button-roles.ts`](../../extension/src/content/agents/button-roles.ts). Icon buttons, a label repeated per entry (each entry's Remove), and buttons drawn apart (Cancel beside Save) act on the form and are never offered as answers. A button that, pressed as an answer, removed what it belonged to marks its look as a command for the rest of the page.
- A single control's label never starts from its own `name` or `id` (how the page refers to it, not what it asks): every real text a person reads comes first, so a question drawn in a `div` beside a textarea names it. A file field is named by the nearest words before it (not a heading further up its section), and its surrounding words are read nearest first.
- A choice group's `label` is its question's words. Text that says nothing (a lone required mark `✱` or `*`, a colon) is never taken for the question; when the options are not wrapped with it, the nearest element before the group that holds no control is (its own text, without a mark inside it). Each radio/checkbox/toggle field also carries `group`, its identity on the page (the group's name scoped to its form), so two questions worded alike ("Yes / No" under two questions of one section) are never confused.
- Text fields that end up with the same label are relabelled from their own wrappers so the planner does not give them all one answer.
- `aria-hidden` mirror inputs and invisible "robot trap" fields are never listed.
- A wrapping `label` is the field's caption, not part of its widget: the value a custom dropdown shows beside its empty input is read from the widget box without the caption, so a filled dropdown inside its label is no longer read as empty (which made a refill "need" fields the page showed filled). A field is `required` when its markup says so (`required`, `aria-required`) **or** the page draws the required mark beside the question that asks it: the question text (the label tied to the control or to its custom-element host, or the words before a group) ends in a lone asterisk or look-alike ([`isRequired`](../../extension/src/content/form-dom.ts)). Typography, not wording; it is how pages that give no ARIA signal still say a question is required.
- Custom dropdowns (`role=combobox` without native options) are **not** listed: their options exist only once opened, so the leftover pass answers them (§9.5).
- A control's own `name` is the last label candidate, after every text a person reads; a real label that happens to read like the control's id or name ("Email" over `id=email`) keeps its place. A control is named by the question beside it even when the control sits inside a custom element's open shadow root: [`labelCandidates`](../../extension/src/content/verify/element-labels.ts) climbs the _drawn_ ancestors (through the host), so the host's sibling label is found, not only the text inside the shadow root.
- **Choice fields carry context too.** A select and a lone box list the control's `id` and the text the page puts after it in its wrapper (`notes`), and the choice question shows both to the decision model (`id: icims_f_Date_Month`, `text under the field: "(checking the checkbox above is equivalent to a handwritten signature)"`). A select option with no text and no label is the blank choice, never an option or an answer, whatever value it carries (a `"0"` first option read as the answer "0"): it is left out of the options and the select reads empty while it is selected. The choice batch's state also carries today's date, so a month or day part of a date is answered from data.
- **Section and identifier.** A field's `section` is the nearest heading element (h1–h6, `role=heading`, legend) before it; a page that titles its sections with plain boxes is read by how it draws them: the nearest short run of words with no control inside, set at least 1.25× larger than the text people type into the page's fields ([`titleBlocksOf`](../../extension/src/content/form-dom.ts), kept 0.5 s). The control's own `id` goes with the field as `identifier`, plain data a page often fills with its meaning (`workHistory.startDate.0`) for the decision model to read.

`pending` mode lists only fields still unanswered and untouched by any plan step; `blocked` mode adds unchecked boxes and marks them `blocking` (the page holds its forward control); `scoped` mode keeps only what the last opening click drew (§10.9); `flagged` mode (Refill) lists only the fields the field-issue scan of the same read names (§7.6). A field answers an issue when the issue's control is its own control, another box of its group, or the hidden box behind its Yes/No buttons; each listed field carries an `issue` note: the issue ids it answers, the value it shows, whether it is marked invalid, and its linked and nearby messages ([`flaggedFields`](../../packages/shared/field-issues.ts)). An issue no field answers (a custom dropdown) stays in the scan alone.

### 7.6 Field issues (what the page flags)

[`content/field-errors.ts`](../../extension/src/content/field-errors.ts) returns `FieldIssueScan` ([`@acorn/shared/field-issues`](../../packages/shared/field-issues.ts)): per control its label, role, current value (passwords hidden), `required`, `invalid` (`aria-invalid` or `:user-invalid`), `linkedMessages` (`aria-errormessage`, `aria-describedby`, `validationMessage`) and `nearbyMessages` (visible text after the control inside its own wrapper), plus page-level `role=alert` messages. A checked box or radio reports its option's words as its value (read through its label, since a native input has no text of its own), or "checked", never empty. A mark the page puts on a field from the start is not a verdict: on its first read of a document Acorn notes which controls are already `aria-invalid`, and a page that marks an _optional, empty_ field invalid (nothing can be wrong with it) uses the mark as decoration on every field. Such a control counts as flagged only when the page says something about it (a linked or nearby message) or it is required and still empty ([`noteInvalidBaseline`](../../extension/src/content/field-errors.ts)); otherwise every Next click would "flag" every field and a refill would rewrite answers that were fine. A dropdown drawn as a button over a shut list (§9.5) is scanned too: it appears once the page shows words beside it, and a refill's dropdown pass takes it then (`pageWantsAnswer`). No vendor classes or copy are matched; the Refill planner decides which messages are real errors. Helpers compare scans before and after a click: `countFlaggedSince`, `countRequiredEmpty`, `countNotedSince` (new text beside a field — the only signal on pages without ARIA).

### 7.7 Run's page snapshot

[`run-page.ts`](../../extension/src/pipeline/run-page.ts) builds a `PageSnapshot` for each look:

- `text` (visible text, clipped to 8,000 chars keeping both ends) and `fullText`,
- `controls`: [`collectPageControls`](../../packages/shared/page-controls.ts) — buttons, links, button inputs, and clickable-by-look elements with text/label/`icon` (what their picture shows), `pointer` (no link or button markup), `afterFields` (after the page's last visible field in reading order, where a form's forward control sits), href, enclosing form or chrome region (nav/header/footer), disabled, in-dialog, covered, and nearby text for icon-only buttons; dialog controls first, covered last, max 120,
- `scan` (field issues) and `flagged` (count),
- `signature` = host + path + hash of the field set (never values), or of the text when there are no fields — the same step keeps its signature through validation errors, a new step does not,
- `fields` (count), `frames` (titles/addresses of other embedded frames, e.g. a verification widget), `scope` (when asked).

A failed read (page loading, content script not yet injected) is retried every 2 s for up to 30 s, re-injecting the script each time whatever the tab's loading state says (a page that never finishes loading is still a page whose script must be there) and tracing `run:reinject` with the frames reached or the error. When every frame still reports no listener, the run stops with the known reason `page_unreachable` instead of asking the decision model (which read it as a site error).

### 7.8 Page probe

`acorn:page-probe` ([`page-probe.ts`](../../extension/src/content/page-probe.ts)) is a cheap fingerprint: URL, hash of the field set, count of visible refusals (`aria-invalid`, `role=alert`), number of clickable controls, visible text length, and whether the page says it is loading (`readyState`, `aria-busy`, `role=progressbar`). Settle loops poll it every 400 ms instead of serializing the page.

---

## 8. The Fill pipeline

[`runFabPipeline`](../../extension/src/pipeline/run-pipeline.ts) is the single fill engine. The sidebar's (hidden) Fill page / Refill buttons call it directly; Run calls it for every page it fills. Inputs that matter: `mode` (`fill` or `refill`), `requireResume` (Run: a fill with no résumé file stops before touching the page), `pendingOnly` (only what is still unanswered), `scoped` (only what an opening click drew), `verificationCode`, and an abort `signal`.

```text
fetching ── read DOM (+fields / +issues)          ┐
            load résumé file                     ├─ in parallel
            GET /acorn/runtime-file              ┘
   │  refill: flagged fields + issues; files only once its plan uploads one
   │  keep résumé only if page is on the job's apply site (eTLD+1)
   │  Run with no résumé → error "No résumé file to attach"
   │  Refill with nothing flagged → done
   ▼
analyzing ── planner tree ── plan:
   │           code-only page + verificationCode → code plan (no model)
   │           pendingOnly / scoped fill with no fields → empty plan
   │           scoped fill → fast plan of the scope's fields
   │           otherwise fast plan (Jev + writer), fallback full planner
   │           refill → fast refill of the flagged fields; the refill conversation
   │                    (with this page's plan history) when it leaves an issue open
   │  applicant-identity rewrite · spread code over boxes · redact for display
   ▼
running ── runActionPlan:
   │   uploads first ─▶ beforeFills: choice batch (one Jev call) ─▶ other steps in plan order
   │   each step → acorn:plan-step in the form frame (120 s)
   │   page navigating away? abort remaining steps
   ├─ late fields: up to 3 looks for fields drawn after the plan (fast plan of new ones only)
   ├─ drift repair: put back answers the page cleared
   ├─ leftover dropdowns (120 s budget; refill: blank ones the page asks for) ─▶ late fields again
   └─ frame reloaded mid-fill? wait, re-read, re-plan (≤ 3 times)
   ▼
done / error ── "Done · N ok · 42s · $0.0123"  (sidebar Refill: "· K still flagged")
```

Step by step:

1. **Résumé file.** [`loadFillResume`](../../extension/src/pipeline/fill-resume.ts) picks, in order: a remembered tab's recommended Library résumé or generated résumé; for a Worker Pool job, its completed recommend result, its completed generation, else `GET /acorn/jobs/:id/recommended-resume`. Run starts loading the file the moment recommend picks it ([`prefetchFillResume`](../../extension/src/pipeline/fill-resume.ts)), so it loads while Apply is clicked and the form draws; the fill joins a load still in flight. A fill whose résumé is already assigned ([`resumeIsAssigned`](../../extension/src/pipeline/fill-resume.ts), from the tab's stored state alone) requests its plan while the file loads, and settles the file before the first step touches the page: no file, no action, as before (`No résumé file to attach`). Each file request is bounded (a stored-copy read 3 s, the request 90 s). Files are kept in memory for 10 minutes (8 files) within a run, and on disk in IndexedDB `acorn-file-cache` ([`file-cache.ts`](../../extension/src/pipeline/api/file-cache.ts)) by account and address with the ETag the API gave each: every use asks the API whether that version is still current, so an unchanged file costs a bodiless `304` and an edited one is fetched anew. The disk cache keeps under 200 MB by dropping the files used longest ago; nothing downloads the whole Library ahead of time. For a job tab the file is used only if the page shares the apply URL's root domain.
2. **Runtime file.** `GET /acorn/runtime-file` returns an optional fallback file the server is configured with (`ACORN_RUNTIME_FILE_PATH`) for generic upload fields; 404 means none.
3. **Plan request.** [`requestPlan`](../../extension/src/pipeline/plan-request.ts) tries the **fast planner** first (`mode: "fast"` with the field list; `FAST_FILL_ENABLED = true`) and falls back to the **full planner** (`mode: "fill"`, the planner tree only) if the fast plan fails or has no actions. The request also carries a `page` block: title, URL, the applicant's local date (`today`), the bound job, which résumé is available. Refill sends `mode: "refill"`, the field issues, the flagged fields (`formFields` read in `flagged` mode, §7.5), and the page's earlier plans (`history`, at most 4 turns). The backend plans the flagged fields first with the fast planner (§13.3, fast refill); only when that leaves an issue open does the refill conversation continue from the history. A backend that does not echo `mode: "refill"` is refused ("This Acorn server doesn't support Refill yet"); an older one that ignores `formFields` plans every refill with the conversation. A scoped refill (fixing an entry form a requirement opened, §10.9) is a refill of the flagged fields in the scope. A refill loads the résumé and runtime file only when its plan uploads one. No read carries page HTML, and plan requests carry only the compact tree and field list (no debug payload).
4. **Post-processing.** [`applyApplicantIdentityToActions`](../../packages/shared/plan-runner/applicant-identity.ts) turns any "yes / I consent" on an AI-tool or automated-decision question into "No". A code planned whole into one-character boxes is spread one character per box. Plans shown in the panel or logs are redacted (`(hidden)` for password fills).
5. **Running the plan.** [`runActionPlan`](../../packages/shared/plan-runner/orchestrator.ts):
   - runs **upload steps first** (a résumé upload often makes the site parse it and rewrite the form; answers given after the upload survive that), then every other step in the planner's order;
   - before the first non-upload step, runs the **choice batch** ([`pipeline/choice-batch.ts`](../../extension/src/pipeline/choice-batch.ts)): the page lists every planned select / radio / Yes-No / checkbox step whose value is not already an exact option, one `POST /acorn/pick-options` decides them all in one Jev call, and the steps' values are rewritten to exact labels;
   - fetches the Library **cover letter** lazily, only if the plan uploads one;
   - blocks steps that target `forbidden` indexes (the planner marks Submit as forbidden), skips résumé uploads into non-résumé fields and cover-letter uploads when the Library has none;
   - sends each step to the page and records `ok` / `skipped` (already filled) / `failed` / `blocked`; the unattended pause policy skips failed steps and continues planned pauses.
6. **Late fields** ([`late-fields.ts`](../../extension/src/pipeline/late-fields.ts)): sections that render late, fields an import re-rendered, follow-ups an answer revealed. Up to 3 looks, each planning only questions (by label) it has not seen, with the fast planner.
7. **Drift repair** (§9.6), then the **leftover dropdown pass** (§9.5), then late fields again (a dropdown answer can draw an address block). In a Refill the pass answers only blank dropdowns the page asks for (required, or marked invalid) and never re-judges values the site put in itself; late fields follow it only when it answered one.
8. **Page replaced under the fill** ([`frame-navigation.ts`](../../extension/src/pipeline/frame-navigation.ts)): `webNavigation.onBeforeNavigate` on the fill's frame or any frame holding it means the document is going away (some sites submit the form as soon as a résumé is attached). Remaining steps are dropped, the pipeline waits for the new document (≤ 60 s), lets it settle, re-reads, and plans again — at most 3 times. **Documents already delivered** ([`delivered-files.ts`](../../extension/src/pipeline/delivered-files.ts)): the run remembers, per tab, which upload steps went through on which address and field (label). A page that took the upload and drew itself again (an upload it reads on its server and rebuilds the form around) shows the file in its own words, or not at all, so the next plan would upload the same document and start the redraw over. That upload is dropped from the next plan (`upload:already-delivered`) unless the page flags the field, and the file input is not counted as required-and-empty in the page read (`scanWithoutDelivered`). The memory starts empty with each run and forgets an address when the application moves on from it. **A plan for a page that is gone:** when every step of a pass fails because its element is no longer in the document (`planTargetsGone`), the pass counts as a page replaced without a navigation (a frame swapped for its twin) and the page is read and planned again.
9. **Result.** Progress carries the phase timings (`dom` for the page read alone, `resume` and `runtime` for the files, `plan`, `steps`, `late`, `drift`, `leftover`…), and the AI cost: every call the server pushed for this tab's usage key between the fill's start and end (§12.6). Each read also logs the page's own `timings` (form wait, serialize, issues, fields) in the Logs DOM entry and the `dom:read` trace; a refill traces which planner planned it (`refill:planner`). A refill started by the sidebar ends with a rescan for "· K still flagged"; Run's refills skip it, since the run reads the page right after.

---

## 9. Executing one plan step inside the page

A plan step ([`PlanStepPayload`](../../packages/shared/plan-runner/types.ts)) is `{ action, element_index, expected_label, expected_role, value, file, ms, force }`, with action `fill | clear | upload | resume_upload | select_radio | wait | validate | verify_only`. [`runPlanStep`](../../extension/src/content/plan-step-runner.ts) handles it.

### 9.1 Find and verify the element

1. Resolve `element_index` through the frame's id attribute (shadow roots and readable child frames included); if a site cloned the node, prefer the displayed form control.
2. **Hold to the group.** Plan actions on a choice field carry `expected_group` (the field's `group`, put there from the same read's field list). The control a step resolves to must belong to that group; a label that reads differently does not stop a control that is in the group, and a control in another group is never acted on: the step moves to its own group's option for the intended value, or fails (`step:group` trace). After a choice step the group must hold an answer, or the step fails ("the question still has no answer") instead of reporting ok. Without a group the label guard below applies as before.
3. **Verify** ([`verify-element.ts`](../../extension/src/content/verify-element.ts)): a `<label>` resolves to its control; the inferred role must match `expected_role` (with aliases: a combobox may present as a textbox, a "buttons" field as radios, etc.) and one of the control's label candidates must match `expected_label` (normalized; truncated long labels match by a 40+ char prefix; otherwise ordered token subsequence).
4. If verification fails and the step named no group (the form re-rendered after an upload and ids went stale), **relocate** ([`verify/relocate.ts`](../../extension/src/content/verify/relocate.ts)): search all inputs/selects/textareas/comboboxes/options for a unique displayed match on label + role, using the value to break ties and separating "confirm password" from "password".
5. A step that names an invisible companion input acts on the field's visible control that opens a list.

### 9.2 Before acting

- The question text around the control is read again and the applicant-identity rule is re-applied (never "used AI", never consent to automated decisions).
- `clear` on an already empty field, or an upload whose field already shows this very file (by file name), is a no-op success — resending a file would restart the site's upload/reset cycle.
- Unless Refill forces it, a control that **already shows the intended answer** (browser autofill, résumé parse, an earlier fill) is left alone and reported `alreadyFilled` ([`already-filled.ts`](../../extension/src/content/agents/already-filled.ts)).
- Password values never reach traces: shown as `(hidden)` by the box type or the `password` role.

### 9.3 Actions

**A value a script sets and the page drops is typed.** A text field that keeps its own state (a masked date, a box that builds tags) empties a value set from script. The fill then types it with the browser's own input events: the content script focuses the field and selects its content, the background sends `Input.insertText` through the debugger (the run's session when there is one, otherwise one attached for the typing), and the events are trusted. Only when that also leaves the field empty is the fill "rejected" (`acorn:type-trusted`, [`trusted-typing.ts`](../../extension/src/content/agents/trusted-typing.ts)).

| Action                    | How ([`content/agents/`](../../extension/src/content/agents))                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fill` (text)             | Native value setter + `input`/`change`/`InputEvent` + a jQuery bridge when the page has jQuery, entered and left with `focus/focusin` and `blur/focusout` (sent by hand when the tab has no window focus) because many forms validate only on leaving the field. Typed inputs get the native format first (`date` → `YYYY-MM-DD`, `month`, `time` → `HH:MM`, `number` → digits). A value the browser drops is a failed step, not a blank answer.                                                                                 |
| `fill` on other kinds     | `<select>` → native select (or its enhanced widget's combobox); checkbox/radio inputs, ARIA radios/checkboxes/switches, fieldsets, buttons → choice selection; `role=combobox`, `aria-haspopup=listbox`, `aria-autocomplete=list`, or a **search box** (`type=search`, `role=searchbox`, `enterkeyhint=search`) → combobox selection; contenteditable → text.                                                                                                                                                                    |
| `select_radio`            | A control that opens a list → combobox selection; otherwise [`selectRadioElement`](../../extension/src/content/agents/select-radio.ts) (§9.4).                                                                                                                                                                                                                                                                                                                                                                                   |
| `upload`, `resume_upload` | Build a `File` from the base64 payload in the format the field accepts (§11.5), set it through `DataTransfer`, fire `input`/`change`, follow the input if the site remounts it, wait up to 15 s for evidence the page took it (file name shown, input holds the file), then wait for the site's parse to settle (values stop changing for 1.5 s, capped at 20 s). `resume_upload` never goes into a cover-letter/transcript field; when the targeted control is an "Import résumé" button it finds the nearby résumé file input. |
| `clear`                   | Empty the field (Refill clears optional filler the profile does not support).                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `wait`, `validate`        | Sleep `ms`; check that the listed indexes hold values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

After a `fill`, a field that ends up empty fails the step ("The page did not keep the typed value").

### 9.4 Choices (radio, checkbox, Yes/No buttons)

- The option is chosen from the field's own named group only (the browser's group by name), even when another question's options sit beside it under one parent. The field's group is found structurally: same-name native inputs rooted where they meet; otherwise the field's own wrapper, a `fieldset`/`radiogroup`, or the nearest set of option buttons.
- The option whose label **equals** the value wins, then whole-word containment ("No" is not inside "I do not know"). A checkbox group with a non-boolean value is decided as a set by Jev (`multiple: true`: one yes/no per box in one call; the decision is reused for 30 s across the planner's per-box steps).
- When no label matches, Jev picks the most probable option (`/acorn/match-option`) — except for **plain buttons with no state**, which might act on the form (remove an entry, close a form) and therefore only take exact answers. A plain button press is verified by watching whether its question's buttons are still all present afterwards; a button that removed what it belonged to is remembered as a command and never pressed as an answer again.
- A chosen option is never clicked again (a second click un-chooses on many widgets). A hidden native input behind a visible option counts only once the page shows it chosen; otherwise the step fails instead of silently passing.
- A step that asks a **lone checkbox** to stay unchecked has answered it: the check that "the question still has an answer" applies to radio groups and checkbox sets, never to a single box (unchecked is one of its two answers; an entry that is not the current job stays unchecked).

### 9.5 Dropdowns and comboboxes

[`chooseOption`](../../extension/src/content/agents/combobox/choose-option.ts) picks the option for a value:

1. A search box shows its real answers only once searched: type the value (or the writer's estimate) and press Enter first.
2. Open the list (retry once if it renders late). An option whose text is exactly the value (ignoring case, spacing, "A." markers) wins.
3. A list of **≤ 30** options (or one that cannot be searched) goes to Jev once, whole. Jev's cost is per input token, so longer lists are narrowed first.
4. A longer list is narrowed by typing the value **word by word** until ≤ 30 options remain, then Jev decides that window (it may answer "not listed" because the window is partial). If not found, it searches again from later words ("The University of X" → "University of X"), then decides the shown list once more with "list complete" semantics: a specific fact (a city, a school) that no option is stays unanswered rather than becoming a different one.
5. A field that showed suggestions while typing (an address line) keeps the typed text when no suggestion is the answer.
   **Dropdowns drawn as a button over a shut list.** Some design systems draw a dropdown as a plain `div`/`button` with no select, no combobox role and no `aria-haspopup`, beside a closed `role=listbox`; the only `role=combobox` is a filter input that is hidden until the list opens. [`markListOpeners`](../../extension/src/content/agents/combobox/list-opener.ts) finds them by shape: a shut list that no control _on screen_ names (`aria-controls`/`aria-owns`/`list`; a hidden filter input inside the shut popup that names it does not count) and an on-screen button before it inside a box (up to 8 drawn levels up, through shadow roots) that holds no other list. The button is stamped (`data-acorn-opens-list`) and from then on every dropdown path treats it as a dropdown: the leftover pass candidates, `resolveDropdownInteractionTarget`, `fillElement`, the options it owns, `opensOptionList` for a `select_radio` step, and the field-issue scan. The stamp is set before each page read, at the start of each leftover round, and before each plan step (a page may redraw it). Its question is the label the page ties to the custom element it belongs to (`<label for>` naming the host), found through the host (§7.5); what the button shows (its placeholder or the chosen answer, which an `aria-labelledby` often points at) is its value and never its question. A list on screen is never a popup, so a visible list of choices is not stamped. Two guards keep it from stamping a menu or link that merely sits near a hidden list (a header's user menu beside a hidden language list): the button must declare popup behavior in standard ARIA (`aria-expanded`, `aria-haspopup`, or `aria-controls`), and the box around it must hold no other on-screen control a person can press: a widget is one control with its popup. A control that opens no popup at all after both opening gestures is given up on at once instead of waited on. When this finds nothing the issue scan still shows the dropdown once the page shows words beside it after a click, and the refill escalates to the conversational planner with the DOM tree (§13.3); a required one nobody can fill stops the run naming it.

6. After clicking, an option that opened a deeper menu level is followed (Jev decides each level, up to 3), and the popup is closed. The click's outcome is looked at every 40 ms and acted on as soon as it shows (the popup closed for three looks in a row, or a deeper level drew), waiting at most 700 ms, not the full 700 ms every time. A control that says it opens a listbox (`aria-haspopup=listbox` or `role=combobox`) goes through this path whatever its tag: a button that opens a listbox keeps the field's label and the caller's options (a leftover pass's instruction is never typed as a search). **A search that finds nothing leaves the box as it was:** the search empties the box and types its queries into it, so a failed search puts back what the box held before it (`restoreTypedValue`); the last query is never the answer. **A tag box** (a text input that turns what is typed into an item beside it) reads empty once the item exists: [`controlAlreadyMatches`](../../extension/src/content/agents/already-filled.ts) treats the answer as held when an element of the field's own box has it as its own text (not a label, button or option), so later passes do not add the same tag again.

**List size and waiting.** A list of up to **300** options is read whole by Jev (`JEV_LIST_MAX`): a couple of thousand tokens cost far less than narrowing it by typing, which waits seconds per step. A longer list is narrowed by typing as before, and a long list that Jev answered "not listed" for may still be a partial window and is searched. Typing into a suggestion box that shows no popup at all gives up after 1.5 s instead of the full filter window per word.

**Popups with no ARIA roles.** A dropdown drawn from plain elements opens a list of plain elements. [`newPopupRows`](../../extension/src/content/agents/combobox/popup-diff.ts) finds it by what happened: the page's visible elements are recorded before the control is opened, and when the usual lookup (roles, `aria-controls`) finds no option after both opening gestures, the rows that are new and visible are the list — short texts with no new element inside them, grouped by the element holding them, at least two distinct rows, the group nearest the control winning. The decision model chooses among their texts like any list (an exact option needs no model), the row is clicked, and `combo:popup-diff` is traced. It runs before the full 3 s wait, so a popup of this kind costs about 1.5 s to read instead of 11 s and a failed step. Structure and timing only.

The **leftover pass** ([`leftover-combobox.ts`](../../extension/src/content/agents/leftover-combobox.ts)) answers dropdowns no step answered (in fast fill that is every custom dropdown):

- Candidates: shown, enabled, empty dropdowns no plan step touched, plus site-prefilled values the profile contradicts (the writer's estimate is compared with the shown value by Jev).
- Each dropdown's label includes its section, fieldset legend, and date-part group ("Education — Start Date — Month").
- Per round, every dropdown's options are read and its decision is started at once: a whole list (≤ 30 or not searchable) goes to Jev with the instruction "Answer from the applicant profile"; a long searchable list gets the writer's short estimate (`/acorn/qa`) to type. Answers are applied one dropdown at a time, each the moment its own decision is in (the first click does not wait for the slowest decision); a decision that fails falls to the one-by-one path. Each gets 2 tries.
- Up to 3 rounds and 40 dropdowns; unanswered ones are retried when another answer changed the page (a state narrows its cities). New work stops at a deadline 15 s before the 120 s budget so the page is free when the run moves on.
- A dropdown the page requires whose whole list holds no option the profile points at is asked once more for the most common selection (the list read as complete), and when that finds none it takes any option ([`commonOrAny`](../../extension/src/content/agents/leftover-combobox.ts)): a required dropdown left empty only stops the form. Only a decision that was made gets here; a failed call is the one-by-one path, and an optional dropdown stays unanswered.
- In a Refill (`flagged`) the pass takes only blank dropdowns the page asks for (required, or marked invalid) and skips the site-prefilled check: a custom dropdown is in no field list, so this is how a refill answers one the page flags.

### 9.6 Memory inside the page and drift repair

[`plan-fill-registry.ts`](../../extension/src/content/agents/plan-fill-registry.ts) remembers, per document, every widget a step answered, the step itself, the time, and what the control showed right after (a dropdown shows the picked option, not the planned words). Later passes (late fields, leftover) never overwrite these. An element is live only if it is connected **and** its document still has a window: a frame the page reloaded keeps its old elements "connected" to a dead document, and repair relocates them by label instead of typing into them.

**Drift repair** ([`drift-repair.ts`](../../extension/src/content/drift-repair.ts)) replays, with `force`, every answer given since the fill started whose control no longer shows it — found again by label if the page remounted it. No model call. Plain buttons are never replayed (a second press may undo them). Answers that went into an entry form the page took and closed are forgotten so they never land in other fields with the same names.

### 9.7 Behaving like a person

- Clicks go to where a mouse would land ([`pointer-activate.ts`](../../extension/src/content/agents/pointer-activate.ts), [`click-control.ts`](../../extension/src/content/click-control.ts)): the deepest element at the target's centre, or a same-size transparent layer laid over a button. Full pointer/mouse sequence, `composed` events so custom elements hear them, then `HTMLElement.click()`.
- **Hidden-tab timers** ([`page-timer.ts`](../../extension/src/content/page-timer.ts)): Chrome throttles timers in background tabs (to ≥ 1 s, later to 1 min). Since Run works in several tabs at once, every wait ≥ 20 ms in a hidden tab is timed by the service worker (`acorn:page-delay`) instead, with the page's own timer as a backstop.
- During Run the debugger also turns on focus emulation, so widgets that only open for a focused page work in background tabs (§10.12).

---

## 10. Run: the multi-page orchestrator

[`runOrchestrator`](../../extension/src/pipeline/run-orchestrator.ts) is a state machine in the service worker. Every "what is this page" and "what do I click" is a Jev decision (`POST /acorn/run/read-page`); nothing matches button text.

### 10.1 Starting and stopping

`acorn:start-run` ([`messages/run.ts`](../../extension/src/background/messages/run.ts)) refuses a tab that is already filling or generating, registers an `AbortController` for **Stop**, adds the tab to `pipelineRunningTabIds` and `runTabIds`, and replies at once. The run receives:

- `stopBeforeSubmit` — from the start message if it sets one, else `chrome.storage.local.acornStopBeforeSubmit` (default **off**). See §15: the switch is not shown in the current UI.
- `resumeFrom` — the tab's checkpoint when the user pressed **Continue**.

**Stop** aborts the signal: every long wait races it, and every page action checks it first, so nothing touches the page after Stop. The run ends with outcome `stopped`.

### 10.2 The loop

Each iteration (max 60) is one look at the page:

```text
┌─▶ 1. LOOK ── the page a click just produced, or a fresh read
│      (blank page? wait up to the slow-page budget)
│      new step?  (§10.4)  → new PageState, page count (≤ 25)
│      account step just sent? → Jev judges how the site answered (§10.7)
│      a password reset was accepted? → read the reset link from Gmail
│
│   2. SAME PAGE AFTER A FORWARD CLICK?
│      fields flagged / required still empty / new text beside fields
│          → Refill: fast refill of the flagged fields, the conversation with
│            this page's plan history when it leaves one open (≤ 3 per page)
│          (a typed email code the page rejects → stop "code rejected")
│      only a new page alert → quick read: confirmation? done.
│          otherwise fill what is still blank (pendingOnly), once
│      nothing changed → "no effect" (stop after 3)
│
│   3. FIRST LOOK AT THIS STEP?
│      read (start intent); re-read "blocked"/"other" pages while they load
│      detour site done?            → back to the application
│      confirmation                 → COMPLETED
│      off the application (other)  → reopen the posting (≤ 2 times)
│      blocked / other              → stop
│      résumé recommend must finish → none? stop before touching the page
│      verification? choose email / read code or link from Gmail / wait for the person
│      job posting                  → click Apply (or Jev's best guess) ──────┐
│      account step                 → guest path if offered, else account goal │
│      fill the page (unless it has no fields / is not the goal's form)       │
│                                                                              │
│   4. ADVANCE                                                                 │
│      drift repair · read (advance intent)                                    │
│      confirmation → COMPLETED · verification …                               │
│      no progress for 2 rounds at this address → stop                          │
│      page requires something via a control? → do the requirement (§10.9)    │
│      pick forward control (or fallback ≥ 20 %); none → stop                    │
│      Stop before Submit and role = submit → READY_TO_SUBMIT                   │
│      click → settle (§10.5)                                                   │
│        disabled right after its own click → wait for the page (≤ 5 × 3 s)     │
│        disabled → fill what it waits on (pendingOnly, ≤ 2 passes)             │
│        never landed → fresh read (≤ 2 misses in a row)                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 10.3 What a page read asks Jev

The extension sends ([`api/run.ts`](../../extension/src/pipeline/api/run.ts)): URL, title, clipped page text (without anything the page keeps hidden), controls (with ids), **the page's fields** (label, kind, required, number of choices, as the planner lists them — a text box is not a control, so without this a question worded like a challenge reads as plain text), flagged count, page alerts, the account steps already sent on this site and how they went, the account goal (only on account steps), the lines that appeared since the last read of this address (the page's answer to the last action, wherever it appeared), the last click and its role, and an opened scope's control ids.

[`selector.ReadPage`](../../../acorn-backend/selector/advance.go) asks all of this in **one** Jev call:

| Question                                     | Answer                                                                                                                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page_kind`                                  | `job_posting`, `application_form`, `account_step`, `confirmation`, `blocked`, `other`                                                                                                                                                                |
| `control`                                    | Which control moves the application forward (or `none`); role is derived: posting → `apply`, account step → `next`, last step → `submit`, else `next`.                                                                                               |
| `is_final_step`                              | Whether the forward control sends the application.                                                                                                                                                                                                   |
| `continues_without_account`, `guest_control` | Whether there is a guest path, and its control.                                                                                                                                                                                                      |
| `verification`                               | `none`, `email_code`, `email_link`, `choose_email` (email is one of the places to send a code), `other` (a CAPTCHA or bot-check widget, a code sent only to a phone, an authenticator code — never a question or field of the form, however worded). |
| `account_mode`                               | `sign_in`, `create_account`, `reset_password`, `choose`, `identify` (email first), `none`.                                                                                                                                                           |
| `offers_sign_in/create/reset`                | Which account steps the page offers (its form, or a control that opens one).                                                                                                                                                                         |
| `outstanding_requirement`                    | (advance only) A control that completes something still required (an assessment, an entry to add, a section flagged as an issue).                                                                                                                    |
| `save_opened_form`                           | (with a scope) Which of the opened form's own controls saves it.                                                                                                                                                                                     |

**When the run waits for the applicant.** The model's `other` does not stop a form that has fields to fill: [`shouldWaitForPerson`](../../extension/src/pipeline/run-person.ts) lets the run fill the page and send it (`Fill the form first` decision) whatever the page is read as (an application, an account step), because a challenge shows only when the form is sent. Only a page the run already tried to send, or one with nothing to fill, waits (`Wait for the applicant` decision, with the model's probabilities and the page text in the log); while it waits the page is read again every 20 s and a page that no longer asks for anything is carried on. Everything the run can answer in words is answered by the run; a real CAPTCHA is the one thing left to the person.

The instructions encode the behavioural rules: judge controls by what they do, never by wording; prefer a guest path; inside an open dialog only its controls count (never a covered one); a "how do you want to apply" dialog is answered by applying manually on this site, never reusing a previous application or another service's login; never join a talent community; never go back, cancel, save a draft, sign out, or follow header/footer links; never click a progress-tracker step; a disabled forward control is still the forward control (clicking it shows what is missing); codes always go to email. A `confirmation` Jev does not believe (< 50 %) while it is confident a forward control exists is downgraded to the likeliest open kind. When it answers `none` on a posting, form, or account step, the best control with ≥ 20 % is returned as a `fallback` and clicked before the run concludes it is stuck.

### 10.4 Is it a new step?

[`isNewStep`](../../extension/src/pipeline/run-step.ts): only a click moves the application. A new address (host + path) is a new step; so is a click that navigated, opened a tab, or changed the page's field signature — except clicks inside the step (`resolve`, `commit` roles), and a form posted back to itself at the same address that now flags fields (the click was refused). A page re-read after the run's own work (fill, refill, repair) is never a new step, however much the fill changed it. **The same fields drawn again is the same step:** after a click that navigated, a page at the same address that asks for the same fields (their kinds and labels, `PageSnapshot.fieldsKey`) is the step the site refused, however much else it says now (a message in plain text, no mark on any field). Without this, a form that reloads itself each time was counted as a new page every time and every per-page limit started over (a veteran form re-submitted 10 times in 150 s).

### 10.5 Settling after a click

[`settleAfterClick`](../../extension/src/pipeline/run-click.ts) polls every 400 ms (first look after 1.2 s): a tab opened by the page (`new-tab`; the run moves there), the tab loading or its URL changing (`navigated`), or the probe's fields/URL changing or new refusal marks. When the snapshot's signature changed it waits for the page to settle and returns `changed`; refusal marks or 5 s of nothing return `unchanged` — but only once the page's network is quiet too, so a page still saving or sending the step is not called unchanged; the hard cap is 20 s. A read right after a landed click (within 30 s) that finds no forward control is the page between steps: the run waits 3 s and for the page to settle, then looks again (up to `RUN_MAX_BUSY_WAITS`), instead of stopping with `no_forward_control` (`busy:no-control`). Before reading any loaded page the run waits for the same "settled" condition ([`waitForPageSettled`](../../extension/src/pipeline/run-click.ts)): address, fields, controls, and text unchanged for 1.5 s, **and** no content request of the page's own (document, fetch, XHR, script) in flight or started for 0.7 s; max 15 s. The network part comes from the run's debugger session ([`network-activity.ts`](../../extension/src/pipeline/network-activity.ts)): an app that drew its shell after a route change and is still fetching its form (Workday after Apply Manually) is still in the DOM but not done, and is read only once the data came and was drawn. A request open longer than 10 s is a long-lived connection (polling, a stream) and stops counting, and one open longer than 3 s while the page itself has been still as long no longer holds the page either (`RUN_NETWORK_STALE_REQUEST_MS`: had its answer been going to draw something, the page would have changed); images and fonts never count; a tab with no debugger session (DevTools held it) settles on the page signals alone. Each wait traces `page:settled` (how long, whether the network held it).

### 10.6 Rejections, refills, and "no effect"

After a forward click on the same step: a field the click flagged, a required field still empty, or new text beside a field (pages without ARIA reject in plain copy) triggers a **Refill**: the flagged fields are planned by the fast refill (§13.3), with the page's previous plans kept as conversation history for the refill conversation when the fast refill leaves an issue open. When the flagged fields ask for nothing and the page left messages tied to no field, the conversational planner reads those messages against the tree. A field a refill already answered that the page still flags is **not planned the way the last round planned it**: its `issue.attempts` (each earlier refill answer and how its step went, from the page's plan history) go with the request, and the server plans it with the conversation, which is shown what was tried and told that an ok step on a still-flagged field may have acted on another control ([`RefillFlagged`](../../../acorn-backend/acorn/refill_fast.go)). When the run gives up (`no_progress`), the stop names each field with what was tried on it (`Q (tried "Yes", then "No"; the page still flags it)`). A refill that plans nothing for "noted" text means that text was help copy: the run notes it as the baseline and counts a no-effect click instead. A page alert with no flagged field is read first (a single-page app may show "Application submitted" before its address changes). A click that changes nothing and says nothing is retried, up to 2 times. Before a refill the page is read once more: a page that took the click may still be drawing its next step, so when the second read has other fields or another address it is a new step and gets a fresh fill, never a refill of the one it left (`after-click:page-moved`). **A refused emailed code** is one only when the page flags a box the code went into ([`run-code.ts`](../../extension/src/pipeline/run-code.ts), labels of the fill steps that carried the code): a flag on any other field (an unchecked consent) is that field's and is refilled. Separately, a **progress ledger** ([`run-progress.ts`](../../extension/src/pipeline/run-progress.ts)) records, per address, what the page still needs (flagged / required-empty labels and the named requirement; a message the page already linked to a field before the run's first fill is help text and is not a need); 2 rounds in a row that settle none of it stop the run in seconds ("The page kept asking for the same things"). **A refusal in plain words:** when the click reloaded the page and it now says lines it did not say before the step's first click (`newLines` against `PageState.textBeforeClick`), those lines are the refusal even with no flagged field and no required field blank: they go to the refill as page messages (`pageNotes`), which the conversational planner reads with the tree (a plan for the blank date parts, the unchecked signature…), and they are quoted in the stop when the refill limit or the no-effect limit is reached ("The page says: …"). **Required fields still blank before the first click** (`countRequiredEmpty` on the post-fill scan) get one refill pass first (`RUN_MAX_BLANK_PASSES`), so a step is not carried to the page that checks it incomplete.

### 10.7 Account steps

When the site requires an account, the run uses the profile's email and **default account password** (a profile field; the run stops with "add a default account password" when there is none and a step needs it). An email-first step (`identify`) needs no password ([`needsAccountPassword`](../../extension/src/pipeline/account-goal.ts)): it is filled and sent, and the form that follows asks for one when the site has one (some sites only email a code). The order is fixed code in [`account-goal.ts`](../../extension/src/pipeline/account-goal.ts), fed only by evidence Jev reads:

```text
guest path offered (and account work not started on this site)?  ─▶ take it, once
otherwise:
  sign in ─(refused)─▶ create account (if offered and the site did not say the account exists)
          ─▶ sign in ─(refused)─▶ reset password (request → open emailed link → save new password)
          ─▶ sign in ─(refused)─▶ stop "Tried signing in, creating an account and resetting the password"
email-first page (identify): fill it and send it; the next form says whether the account exists
  (a sign-in form → existing; a create form → new, so create comes first)
```

- Only the goal's own form is filled; on any other account form the run clicks the control that opens the goal's form.
- A guest control the read names is a way around the account only when it is not the very control that moves the page forward on a page with fields of its own ([`isGuestPath`](../../extension/src/pipeline/account-goal.ts)). An email-first page's own Next is often named as both; it sends the page's form, so the run fills the email and sends it (logged `guest:own-form`) instead of clicking Next with the field empty.
- After each account click, `POST /acorn/run/account-outcome` has Jev judge the next page: `accepted` (signed in, created, reset sent, now asks to verify by email, or shows the next part of the step), `refused` (wrong password, exists, locked, field flagged), or `not_sent` (the click only switched forms). Without a model answer, a structural fallback is used. A page that answers an account step by asking to verify by email counts as accepted.
- A refused account step is never "refilled" with the same password.
- Limits: 8 account steps per site. History and evidence are kept per site (host) and saved in the checkpoint.

### 10.8 Emailed codes and links

`findInMail` calls `POST /acorn/run/mail-verification` every **5 s** for up to **5 minutes**, and every **20 s** of waiting reads the page again: a page that no longer asks for the code or link (it moved on, or the first read was wrong) ends the wait and is handled as the page it is (`mail:not-asked`), passing `since` (the last click) and `seen` (the server's name for the last list it judged). The server ([`mailcode`](../../../acorn-backend/mailcode/mailcode.go)) lists the newest 10 inbox emails of the connected Gmail that receives the profile email (rows only: sender, subject, preview, time, arrived after the step or not). When the list changed, Jev ranks all 10 together; only the best email is opened (then the second best, if the best holds nothing). Candidates are extracted by code — code-like tokens shown to Jev **masked** in their context, links shown **without query strings** — and Jev picks the candidate by number; the chosen value must be literally present in the email before it is used. When Jev is sure of the email but picks no link, the most probable link is taken.

- **Code**: entered through the fill engine with `verificationCode` (no planner call when the page's required text boxes are exactly the code's boxes: one box, or one per character).
- **Link** (`http`/`https` only): opened in the run's own tab. A link that answers a reset request opens the form that sets the new password.
- **choose_email**: the page asks where to send a code; the run fills it (the planner always picks email) and clicks send.
- No Gmail connected → the run waits for the person (up to 10 minutes, watching for the URL or field set to change, and reading the page again every 20 s: a page that asks for nothing any more ends the wait). A look that fails to reach Gmail is retried; three failures in a row stop the run ("Acorn could not read your Gmail"). A run takes at most 4 codes or links.

### 10.9 Requirements, scopes, and detours

On a filled form, Jev may name a control that completes something still required (`requirement`, ≥ 50 % confidence): add an education entry, open a flagged section, take an assessment. The run does it ahead of the forward control (≤ 8 per page, each control key once until it is known to have worked):

1. Before the click it sends `acorn:scope-census`: the page remembers every element and how many fields asked each thing.
2. After the click, [`scope.ts`](../../extension/src/content/scope.ts) finds what is new — the **scope**: new controls and fields, held by the dialog that opened or the part of the page around it, named by its heading.
3. `completeScope` fills only the scope's fields (fast plan, `scoped: true`), asks Jev which of the scope's own controls saves it (`commit`, ≥ 50 %), clicks it, and checks the scope state: closed → saved; still open with flagged fields → refill and save again (≤ 2 saves, then stop "The page would not take what Acorn filled in"); no save control → its answers stand.
4. If the requirement's click led to another site or tab (an assessment on a partner site), the run remembers where the application was (**detour**) and comes back when that site shows a confirmation or nothing to do.

### 10.10 Limits

All in [`run-limits.ts`](../../extension/src/pipeline/run-limits.ts):

| Limit                                      | Value              | Limit                                     | Value                 |
| ------------------------------------------ | ------------------ | ----------------------------------------- | --------------------- |
| Loop iterations per run                    | 60                 | Pages per run                             | 25                    |
| Model calls per run (all claimed tabs)     | 200                | Fills of one step (any kind)              | 5                     |
| Refills per page                           | 3                  | Clicks with no effect per page            | 2                     |
| Click misses in a row                      | 2                  | Blocked-control passes                    | 2                     |
| Busy waits after own click (3 s each)      | 5                  | Alert passes per step                     | 1                     |
| Requirements per page                      | 8                  | Saves of an opened form                   | 2                     |
| Stalled rounds per address                 | 2                  | Account steps per site                    | 8                     |
| Returns to the posting                     | 2                  | Email codes/links per run                 | 4                     |
| Mail poll / wait / page re-read            | 5 s / 5 min / 20 s | Failed Gmail looks in a row               | 3                     |
| Wait for the person                        | 10 min             | Slow page (spinner) wait                  | 90 s                  |
| Re-reads of a "blocked/other" page         | 3 × 3 s            | Page-read retries while loading           | 30 s                  |
| Click settle: first look / unchanged / cap | 1.2 s / 5 s / 20 s | Page settled: quiet / network quiet / cap | 1.5 s / 0.7 s / 15 s  |
| Page text sent with a decision             | 8,000 chars        | Controls per decision                     | 120 (server caps 250) |

### 10.11 How a run ends

| Outcome           | When                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Panel                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `completed`       | A page read as `confirmation`, or an alert after Submit says so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Celebration; "Done · N pages · 95s · $0.04"          |
| `ready_to_submit` | Stop before Submit is on and the forward control's role is `submit`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | "Ready to submit"                                    |
| `stopped`         | The user pressed Stop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | "Stopped by you"; **Continue** offered               |
| `failed`          | Any `RunStop`. Known reasons are named directly (no résumé, budget, account refused, no password, verification not found, Gmail unreadable, no progress, scope refused, waited for person, tab closed, a required field that needs the person, and a page where no content script answers although it was injected again: `page_unreachable`, "Acorn could not reach this page", reload it and press Continue; a filled form with no forward control found: `no_forward_control`, "click it yourself, then Continue"); otherwise `POST /acorn/run/diagnose` has Jev pick a reason from a fixed list (missing required, rejected answer, upload failed, bot check, login required, no forward control, click had no effect, site error, job closed, not an application, other) from evidence lines (page alerts, flagged fields with their messages, failed steps, embedded frames — never values). | "Run stopped" + label + detail; **Continue** offered |

**What the person reads.** A stopped run is shown in plain words by [`user-messages.ts`](../../packages/shared/user-messages.ts): a title (what happened), a sentence (what to do), and a collapsed **Details** with the raw text, which stays in the Logs tab. The model's own label is kept for a reason it made up; the reasons the run names itself add a next step ("Finish that step on the page, then press Continue"). A page read the AI refused (no OpenRouter key, a rejected key, no credit, a rate limit, the provider down, a timeout) stops the run with reason `ai_unavailable` and the backend's `code`, never the raw model text. The same catalogue words the toasts (`use-tab-work.ts`, `use-work-end-notices.ts`) and the status line, from the error's `code`, then its HTTP status (401 signed out, 402 no credit, 429 rate limit, 502/503 provider), then patterns in the extension's own text (`Failed to fetch` → "Can't reach Acorn", `Control is disabled` → "The page isn't letting Acorn press this yet").

A failed or stopped run saves a **checkpoint** in `acornRunCheckpoints` ([`run-checkpoint.ts`](../../extension/src/pipeline/run-checkpoint.ts)): account history and evidence per site, reset-link sites, mail verifications used, the signature of the page it had filled (not filled again on Continue), the start URL, and the page count. A completed run clears it.

The run's cost is everything the server recorded for the usage keys of every tab it claimed since it started. The run timeline is written to the worker console and to the tab's local log (every event carries the run id, step and page); it is not sent to the server. The `decision` entries (`RunLog.decision`) record why the run clicked, waited for the applicant, or stopped, with the model's probabilities and the page lines it saw.

### 10.12 Browser dialogs and focus

[`run-dialogs.ts`](../../extension/src/pipeline/run-dialogs.ts) attaches `chrome.debugger` (protocol 1.3) to every tab the run uses (Chrome shows its "started debugging this browser" bar). On `Page.javascriptDialogOpening`: an `alert` is accepted; `confirm`/`prompt`/`beforeunload` go to `POST /acorn/run/dialog`, where Jev says whether accepting keeps the application going (accept) or would withdraw/discard it (dismiss); undecidable dialogs are dismissed. The same session enables `Emulation.setFocusEmulationEnabled`, and `Network.enable` so the run can tell when a page is still fetching (§10.5); only each request's kind and timing is kept, never its address, headers, or body. If DevTools already holds the tab, the run goes on without it.

### 10.13 Auto-Focus

With the Auto-Focus switch on and Run working in more than one tab, the worker brings each run tab to the front in turn every few seconds ([`background/auto-focus.ts`](../../extension/src/background/auto-focus.ts)), so every page runs as a visible tab.

---

## 11. Résumés, cover letters, and file formats

### 11.1 The résumé gate

Run never touches a page without a résumé chosen for it. On the first look at the first page, [`ensureRecommendedResume`](../../extension/src/pipeline/run-resume.ts) checks whether the tab already has one (a remembered tab's recommendation or generation, or the bound job's). If not:

- a Worker Pool job bound to the tab → `runJobRecommend` with the job's stored description;
- otherwise → the tab is remembered with `resumeMode: "recommend"` and `runCustomRecommend` reads the posting text from every frame of the tab.

Both end at `POST /acorn/custom/recommend`. If no résumé results, the run stops with "No résumé was chosen for this job" before any click. The response carries `timings` (milliseconds the server spent: `session`, `setup`, `candidates` — the Library rows, cached for 5 minutes — `match`, `total`), and the run logs `recommend:stages` with this side's stages (`queued`, `read-page`, `request`, `complete`, …) beside the server's (`server-*`), so a slow recommend shows where its time went.

### 11.2 Recommend

[`resume.Recommend`](../../../acorn-backend/resume/recommend.go) + [`selector.MatchPosting`](../../../acorn-backend/selector/gateway.go): the Library's résumés are grouped into **stacks** (same title, several formats); each stack is described by its title and up to 20 analyzed skills. The title is the file's **alias**, set at upload in the web app's Library ([`resume-library.tsx`](../../../acorn-frontend/components/workspace/resume/resume-library.tsx)): a single file (one at a time) asks for it in a modal, starting from the file name; a folder upload uses the file's path below the picked folder plus its name, lowercased and joined by dashes ([`library-alias.ts`](../../../acorn-frontend/components/workspace/resume/library-alias.ts)), so `Resume/FullStack/Java/David.docx` picked as `Resume` becomes `fullstack-java-david.docx`. The alias is the `stack` the extension lists for each recommendation. One Jev call asks two questions: is this text a job posting (P ≥ 0.5, else HTTP 422 "No job description on this page"), and which résumé fits (by tech stack, domain, required skills). There is no threshold: the most probable stack is recommended, and the top 3 with probabilities are shown on the Now card.

### 11.3 Which file a fill attaches

`resume_upload` steps take, in order of the tab's mode: the generated file (remembered tab in Generate mode), the recommended Library file, a Worker Pool job's generation or recommendation, or `GET /acorn/jobs/:id/recommended-resume`. Generic `upload` steps take the server's runtime file. Library files carry their other formats as `variants`.

### 11.4 Cover letters

When a plan uploads `cover_letter`, the pipeline sends `POST /acorn/custom/cover-letter` with the posting text (the remembered tab's JD, the job's stored JD, or the first 8,000 chars of the page). The server picks the only cover letter, or the best of several by Jev, and (with `idOnly`) answers with its Library id without reading the file; the file then comes through the cached Library route like a résumé, so the same letter is no download the next time. An older server that sends the file itself is used as is. None → the step is skipped and the field left to the page.

### 11.5 File formats

[`chooseUploadFile`](../../extension/src/content/agents/upload-format.ts): the version sent is the first one the input's `accept` list allows; if the planner read a format from the field's words (`value: "pdf"` or `"word"`), only that format is allowed. A field that takes only a format the stack does not have fails with a message naming what to add to the Library.

### 11.6 Generate (dormant in the current UI)

The code can still generate a tailored résumé ([`run-generate.ts`](../../extension/src/pipeline/run-generate.ts)): five checkpointed steps (`load-jd`, `summary`, `skills`, `experience`, `finalize`); `POST /acorn/custom/generate` enqueues the account's résumé-config pipeline with the JD, `GET /acorn/custom/generate/:inputId` is polled every 400 ms (5 min cap), a failed run can be continued from the failed step (`/continue`, reusing partial sections), and `finalize` downloads the stored DOCX. Custom-tab Generate first extracts the JD from the page's pure tree (`POST /acorn/custom/extract-jd`). The buttons that start it are hidden (§4.4).

---

## 12. The backend (acorn-backend)

### 12.1 Process

[`cmd/server/main.go`](../../../acorn-backend/cmd/server/main.go) loads `acorn-backend/.env`, connects to MongoDB (database `ACORN_DB`, default `AcornDB`), builds the stores, ensures their indexes in parallel, starts process capture (MongoDB, plus a local folder when `ACORN_DEBUG_DIR` is set), mounts `acornapi` at `/acorn` (and Google sign-in at `/v1/auth/google`), warms the TLS connection to OpenRouter's Decisions API, and serves on `HTTP_ADDR` (default `127.0.0.1:8083`). CORS allows the site and console origins; the extension is not a browser origin and uses bearer tokens. Request bodies are capped at 16 MB. All model routes are behind the `acorn_ai` kill switch (`KILLSWITCH_ACORN_AI=off` answers 503).

### 12.2 Routes the extension calls

| Route                                                                                                  | Purpose                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /acorn/auth/extension/signin`                                                                    | Email + extension password → session token.                                                                                                                                                                                                                         |
| `POST /acorn/auth/signout`, `GET /acorn/auth/me`                                                       | Revoke / describe the session.                                                                                                                                                                                                                                      |
| `POST /acorn/auth/support/redeem`                                                                      | Redeem a support handoff code.                                                                                                                                                                                                                                      |
| `POST /acorn/ai-analyze`                                                                               | Plan a page. `mode`: `fast` (field list → decision-model plan), `refill` (field issues + history; with `formFields` the flagged fields are planned by the fast refill first, and the answer says which planner ran in `refillPlanner`), otherwise the full planner. |
| `POST /acorn/match-option`                                                                             | One Jev option decision (`allowNotListed`, `listComplete`, `multiple`). A failed decision is `200 {ok:false}`; the page falls back.                                                                                                                                 |
| `POST /acorn/pick-options`                                                                             | The choice batch (≤ 120 fields) in parallel Jev requests.                                                                                                                                                                                                           |
| `POST /acorn/qa`                                                                                       | Writer answer to one question (Ask tab, selection chip, dropdown estimates).                                                                                                                                                                                        |
| `POST /acorn/run/read-page`                                                                            | §10.3.                                                                                                                                                                                                                                                              |
| `POST /acorn/run/account-outcome`                                                                      | §10.7.                                                                                                                                                                                                                                                              |
| `POST /acorn/run/mail-verification`                                                                    | §10.8. The value is returned only to the caller and never logged.                                                                                                                                                                                                   |
| `POST /acorn/run/dialog`, `POST /acorn/run/diagnose`                                                   | §10.12, §10.11.                                                                                                                                                                                                                                                     |
| `POST /acorn/run/log` (older extensions only)                                                          | Run timeline into the server log and capture; the current extension does not call it.                                                                                                                                                                               |
| `GET /acorn/runtime-file`                                                                              | The configured fallback upload file.                                                                                                                                                                                                                                |
| `POST /acorn/custom/recommend`, `/custom/cover-letter`, `/custom/extract-jd`                           | Recommend a Library résumé, choose a cover letter, extract a JD.                                                                                                                                                                                                    |
| `POST /acorn/custom/generate` (+ `/continue`, `GET` poll)                                              | Résumé generation.                                                                                                                                                                                                                                                  |
| `GET /acorn/custom/library-resumes/:id` (+ `/preview`), `/custom/resumes/:generationId` (+ `/preview`) | Library or generated file `{file:{key,name,mimeType,base64,label,format,variants}}`, with an `ETag` and `304 Not Modified` for `If-None-Match` (as is `GET /acorn/jobs/:jobId/recommended-resume`); HTML previews.                                                  |
| `GET /acorn/jobs/:jobId`, `/jobs/:jobId/recommended-resume`, `/jobs/:jobId/resume-preview`             | Worker Pool job (with stored JD) and its résumé.                                                                                                                                                                                                                    |
| `GET /acorn/profile`                                                                                   | The profile (the sidebar reads `defaultAccountPassword` to show it on account steps).                                                                                                                                                                               |
| `GET /acorn/ai-usage?tab=…`, `GET /acorn/ai-usage/:id`                                                 | A tab's usage list (exact `costNanos`/`totalNanos`) and one entry.                                                                                                                                                                                                  |
| `POST /acorn/support/claims`, `GET …/claims`, `…/claims/:id/messages`, `/read`, `/reopen`, attachments | Support reports.                                                                                                                                                                                                                                                    |
| `POST /acorn/debug/log`, `/debug/shot` (older extensions only)                                         | Process capture uploads (§12.7); the current extension does not call them.                                                                                                                                                                                          |
| `GET/POST /acorn/socket.io`                                                                            | Socket.IO gateway (§5.4).                                                                                                                                                                                                                                           |

The site and console use the rest: profile editing and import from a résumé (`/acorn/profile`, `/profile/from-resume`), the résumé config/templates/generations/Library (`/acorn/resume/*`), Gmail connect and labels (`/acorn/gmail/*`), Google sign-in, and `/acorn/admin/*`.

### 12.3 Where the AI comes from

For each request, [`acornapi/model.go`](../../../acorn-backend/acornapi/model.go) loads the account's profile and builds:

- the **text model**: `openai.OpenRouter(key)` — OpenRouter's OpenAI-compatible chat API, model `openai/gpt-6-luna` (`backend-core/config.OpenRouterModel`), reasoning off, JSON-schema outputs;
- the **decision model**: `jev.New(key)` — `typesafe/jev-1.13` at `https://openrouter.ai/api/alpha/decisions` (`config.JevModel`, `config.OpenRouterDecisionsURL`), wrapped as `selector.Gateway`.

An account without a key gets "Add your OpenRouter API key in profile settings" (503 on generate/recommend routes; the planner returns a model error).

**Error codes.** Every failed model call carries a stable `code` beside its message ([`acornapi/errcode.go`](../../../acorn-backend/acornapi/errcode.go), `modelErrorCode`): `openrouter_no_key` (503), `openrouter_invalid_key` (OpenRouter 401/403), `openrouter_no_credits` (OpenRouter 402, answered **402**), `openrouter_rate_limited` (429), `provider_error` (5xx or unreachable), `model_timeout`, `model_bad_answer` (unparseable or empty), `model_unavailable` (no model configured), plus `signed_out` (401) and `kill_switch` (503). The provider's refusal keeps its status (`openai.StatusError`), so a spent balance is told apart from a bad key. Routes that answer 200 with `ok:false` (the run's decision routes) carry the same `code`. The extension turns codes into words (§10.11); the messages beside them are for logs and may change.

### 12.4 Usage metering

`withUsage` attaches a recorder to the request context: every model call (text or Jev) is written to `acorn_ai_usage` with account, tab key (`X-Acorn-Tab`), route, feature (`fill`, `ask`, `run`, `custom_job`, `recommend`, `resume_generate`, …), client and version, support admin, tokens (prompt, completion, cached), cost in nanodollars, duration, status. Right after it is stored, the entry is pushed to the account's sockets as `ai-usage:recorded { tab, entry }`. The worker's [`tab-usage-store.ts`](../../extension/src/background/tab-usage-store.ts) appends it to that tab's ledger (max 100 entries) and its `chrome.storage.session` view, so the panel's usage list updates live; `GET /acorn/ai-usage` reconciles. Fill and Run compute their own cost as "everything pushed for this tab since my start mark" (waiting 300 ms for late pushes).

### 12.5 The socket gateway

See §5.4. The Go server uses `zishang520/socket.io` v3 with a 16 MB message buffer (DOM trees run a few MB); the handshake token is checked against the session store with a 10 s timeout.

### 12.6 Persistence

All data is in MongoDB (`AcornDB`):

| Collection                                                                 | Contents                                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `acorn_accounts`, `acorn_sessions`, `acorn_google_states`                  | Accounts (argon2id password hashes), sessions (SHA-256 token hashes, 30-day expiry).                       |
| `acorn_profiles`                                                           | The profile document, including the OpenRouter key, default account password, extension password.          |
| `acorn_resume_library`, `_configs`, `_templates`, `_generations`, `_tasks` | Library files (résumés and cover letters), résumé pipeline config, templates, generated files, task state. |
| `acorn_ai_usage`                                                           | One row per model call (no prompt bodies).                                                                 |
| `acorn_debug_traces`                                                       | Process capture, gzipped, per user + tab, expiring after 72 h.                                             |
| `acorn_support_claims`, `_messages`, `_attachments`, `_debug_logs`         | Support reports, screenshots, and the extension's gzipped log sent with each report.                       |
| `acorn_gmail_mailboxes`, `_oauth_states`, `_label_guides`                  | Connected Gmail mailboxes (refresh tokens) and labeling guides.                                            |
| `acorn_admin_*`, `acorn_support_handoffs`                                  | Support console users, sessions, audit trail, handoff codes.                                               |

Library files are slow to read from Mongo (seconds per file), so [`resume/file_cache.go`](../../../acorn-backend/resume/file_cache.go) keeps whole rows with their bytes in memory by account and id, up to 256 MB, the copies used longest ago dropped first. A copy is served without asking Mongo for 30 s; after that one query that skips the bytes (`uploadedAt`, `size`, names, `analyzedAt`, primary) says whether it is current, and only a changed file is read again. Requests for one file at once share one read (singleflight), a stack's formats load side by side, a write through the process drops the copy, and a read is bounded to 60 s. The `ETag` of a Library or job résumé file is the hash of the versions it was built from, so a `304` costs no bytes read at all once the copy is warm. When Recommend picks a résumé it reads that stack and up to three cover-letter stacks into memory beside the request.

Worker Pool jobs come from the shared jobs catalog (`backend-core/jobs`).

### 12.7 Process capture and support reports

**The log stays on the device.** The extension no longer uploads its run timeline or page traces while it runs: the Logs tab (§6) is the whole record, and it holds what the server used to keep for debugging — the page text and controls sent to the decision model, the model's full answer (probabilities, usage), latency and status of every call, and the run's decisions. Backend responses carry what the extension cannot see (`ms`, server `timings`, the model's `kindProbabilities` and `verificationProbabilities`), never prompt text. The server-side recorder ([`debugtrace`](../../../acorn-backend/debugtrace/recorder.go), `POST /acorn/debug/*`, `POST /acorn/run/log`) still exists for older extensions and for local development: with `ACORN_DEBUG_DIR=./debug-runs` it writes run folders (`page.json`, `pure-tree.txt`, `ai-<purpose>.md`, `jev-<call>.md`, `run-<id>-NN-read-page.json`, …) to disk, kept 72 hours in MongoDB when a database is configured.

**Report** (header menu) writes any queued log entries, takes a full-page screenshot (scroll-and-stitch, fixed elements shown once, JPEG ≤ 8 MB), and posts it with the notes, page URL/title, extension version, and tab key. **Submitting** is the only moment the log leaves the browser: the extension then gzips the tab's log (a summary plus every entry whole) and sends it to `POST /acorn/support/claims/:id/log` (`messageId` for a follow-up), which stores it unchanged with the claim (`acorn_support_debug_logs`, ≤ 12 MB gzipped), where admins download it. Opening the Report dialog uploads nothing. A follow-up on an open claim is a multipart message with the screenshot attached.

Locally, `ACORN_DEBUG_DIR=./debug-runs` also writes the run folders to disk, and `cmd/fields-replay` re-runs field discovery over captured trees.

---

## 13. The models and what each one decides

### 13.1 Who decides what

| Decision                                                                                                    | Model               | Where                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| Full plan of a page (every field, values, forbidden Submit)                                                 | text                | `acorn.Analyze`, prompt `prompts/analyze_system.txt`                                    |
| Refill plan of the flagged fields (fast refill)                                                             | Jev (+ writer)      | `acorn.RefillFlagged` ([`refill_fast.go`](../../../acorn-backend/acorn/refill_fast.go)) |
| Does the text with a flagged field refuse its answer, or only help?                                         | Jev                 | `refusedByText` (one batched `ClassifyEach`)                                            |
| Refill plan when the fast refill leaves an issue open (fix only real errors, never repeat a rejected value) | text (conversation) | `acorn.Refill`, `prompts/refill_system.txt`                                             |
| Free-text answers (short facts verbatim, prose in first person)                                             | text                | `acorn.writeAnswers`, `prompts/prose_system.txt`                                        |
| Q&A, dropdown estimates                                                                                     | text                | `acorn.Answer` (same writer prompt)                                                     |
| Is this a job description, and extract it                                                                   | text                | `acorn.ExtractJD`, `prompts/extract_jd_system.txt`                                      |
| Which profile fact fills a text field (or write / skip / other person / person only)                        | Jev                 | `FastPlan` via `ClassifyEach`                                                           |
| Whose detail a field asks for (applicant vs. another person)                                                | Jev                 | `FastPlan`                                                                              |
| File field kind (résumé, autofill drop zone, cover letter, other) and accepted format                       | Jev                 | `FastPlan`; `PickOne` settles one résumé field among several                            |
| Choice fields (select, radio, buttons, checkbox sets, toggles)                                              | Jev                 | `PickBatch` (fast plan, choice batch), `PickOption`/`PickMany` (page)                   |
| "Did the applicant use AI" questions                                                                        | Jev (or text)       | `classifyIdentityByDecision`                                                            |
| Page kind, forward control, guest path, account mode, verification, requirement, save control               | Jev                 | `ReadPage`                                                                              |
| Account outcome, browser dialog, failure reason                                                             | Jev                 | `JudgeAccountOutcome`, `DecideDialog`, `Diagnose`                                       |
| Which email, which code/link                                                                                | Jev                 | `RankMail`, `PickSecret`                                                                |
| Posting? which Library résumé / cover letter                                                                | Jev                 | `MatchPosting`                                                                          |

Jev is asked typed questions (`choice` among keyed criteria, or `noul` = P(yes)) about a text `state`; it answers each with a choice, a confidence, and probabilities, and never generates text. Options are sent as keys (`option_0`, …) so labels round-trip exactly. A question lists at most 255 options; field batches (`ClassifyEach`, `PickBatch`) are split into requests of up to 32 questions that run in parallel, while a page read asks its dozen questions in one request. The client retries transient failures (3 attempts, 30 s timeout) on one shared keep-alive connection pool.

### 13.2 The full planner

`Analyze` sends the system prompt, then "Applicant data" (the profile JSON), the planner tree, the page block, and a closing instruction — profile and prompt first so the provider can cache the prefix. The prompt's rules include: use only indexes in the tree; answer every fillable question including optional EEO ones; the profile is authoritative, otherwise give the most plausible concrete answer; never type filler ("N/A") into typed fields unless the form asks for it; native date/time/number formats; work authorization vs. sponsorship; "how did you hear" from the profile's network URL; never click Submit and mark it forbidden; `resume_upload` with file `recommended_resume` only for résumé fields, `upload` with `cover_letter` for cover letters, `pdf`/`word` from the field's words; `page.today` for signing dates; the applicant is a human (never "used AI", never consent to automated decisions); verification codes always to email. After parsing and validation, `finishPlan` runs the identity classifier and the writer in parallel, and `fillPasswords` puts the real account password into password fills (or drops them when the profile has none).

### 13.3 The fast planner

`FastPlan` plans from the extension's field list without the planner prompt:

```text
fields ──┬─ textareas ───────────────────────────▶ writer (parallel, ≤ 8 calls)
         ├─ text fields ─ Jev: which fact? ─┐
         │               Jev: whose detail? ─┴▶ fact value from profile (code)
         │                                      or "write" ─▶ writer
         │                                      or blank (skip / other person / person only)
         ├─ file fields ─ Jev: kind ─▶ settle one résumé field ─▶ Jev: which document
         │               (any other upload)      ─▶ Jev: format
         └─ choice fields ─ Jev PickBatch (profile = state, one question per field)
                       ─▶ plan: résumé/cover-letter uploads, text fills, choice steps
```

- **Facts** ([`facts.go`](../../../acorn-backend/acorn/facts.go)): first/last/full/preferred name, email, phone, LinkedIn, GitHub, website, street, city, state, ZIP, country, location, current company/title, school, degree, field of study, graduation year, school/job start and end dates, years of experience, desired salary, notice period, pronouns, headline, `account_password`, `verification_code`, `today`. Jev picks a fact by key and description; the value is read from the profile in code, so Jev never sees values for text fields. Date facts (`job_start_date`, `job_end_date`, `school_start_date`, `school_end_date`, and today's date) are not typed as stored: the profile's date is read ([`dateValues`](../../../acorn-backend/acorn/today.go)) and written in the format each field wants — a native date input in its own layout, any other by the decision model reading the field's placeholder, hint and example (year-month-day, month/day/year, month/year, month name and year, year only… each shown written with the date itself).
- `skip`, `other_person` (references, emergency contacts), `unknown_detail`, and `person_only` (phone codes) leave the field blank — the writer answers a blank kind only when the field is required or blocking, and never another person's details.
- A password-type input always takes the account password and nothing else.
- A value typed as a row of short boxes (a code, a split phone number) is cut across them by `maxLength`.
- A **required or blocking single checkbox** is asked with the intent "check it, unless it states something the profile says is untrue or consents to AI/automated screening"; otherwise boxes are answered from the profile.
- The choice batch's shared state is the applicant profile plus fixed rules: the applicant is a human; they give every ordinary consent or acknowledgement; work authorization from immigration status, sponsorship from the sponsorship answer; a profile silent on a history question means "no".
- **A required choice is never left blank by the model.** When the batch picked nothing for a field the page requires (select, radio, buttons, checkbox set; a single box is a consent and never forced), [`settleChoices`](../../../acorn-backend/acorn/choice_fallback.go) asks Jev again for the **most common selection**, and for what is still blank takes **any one option**, because a required choice left empty only stops the form. It runs only when the batch call answered (a failed call leaves the fields to the runtime) and never for an optional field. The custom-dropdown pass does the same for a required dropdown whose list holds no option the profile points at (§9.5).
- **Uploads that are neither the résumé nor a cover letter** are decided too: Jev picks, per field, what the applicant can give ([`settleOtherUploads`](../../../acorn-backend/acorn/fastplan.go)) — the **résumé** (the field asks for one, or for documents in general), the **cover letter**, or **a specific document the applicant does not hold** . The résumé goes in as a `resume_upload` on that very field, and the page side trusts the plan's choice of field (no reading of its words second-guesses it). A document the applicant does not hold gets no step: a **required** one is listed in the plan's `unanswerable` (reason "it asks for a document Acorn does not have") and the run stops before sending the form (`needs_answer`, below); an optional one is left alone. Only when the decision cannot be made (the model failed or answered something unknown) does a required field get the résumé as a guess, and an optional one is left alone. A required cover-letter field the Library has no letter for carries `fallback_file` (the résumé) and gets it ([`withUploadFallback`](../../packages/shared/plan-runner/step-file.ts)); an optional one is left to the page.
- A **text field whose question the page never gave** (its label has no words, or is only the input's machine name: an identifier such as `question_123` or `a.b[0]` — a plain word that matches the name, "Email" on an input named `email`, is a question) is not answered: the writer would invent the answer. A required one is listed in the plan's `unanswerable` with its reason, like a required upload for a document the applicant lacks, and the run stops before sending the form (`needs_answer`: "A required field on this form needs you", then each field with its reason and "Do it on the page yourself, then press Continue"). The run's checkpoint remembers which fields it handed over (`handedToPerson`), so Continue does not stop on the same fields again after the person has done them.
- **A lone box's whole statement.** A lone checkbox's label is clipped to 200 characters; when its group's name is longer, the whole text (up to 1500 characters) rides with the field as `statement` and is shown to the decision model ("the box's whole statement"), so a consent is judged by what it commits to and not by its first lines. A **required** box the model leaves unchecked gets no `false` step: it is listed in `unanswerable` (reason "it is a required box whose statement the applicant's profile does not support checking") and the run stops saying so, instead of sending a form the page refuses. **A document's text typed into a box** (`document_text`: a résumé or cover letter pasted as the alternative to attaching it) is left blank while it is optional; the attached file is the document. **A multi-part answer is whole or empty** ([`dropPartialAnswers`](../../../acorn-backend/acorn/fastplan.go)): optional controls sharing one label in one section, with a dropdown among them (a date's month, day and year), keep their steps only when every part has one.
- Custom dropdowns are left to the leftover pass; any fast-plan failure falls back to the full planner on the extension side.

**Fast refill** ([`RefillFlagged`](../../../acorn-backend/acorn/refill_fast.go)) plans a Refill from the flagged fields alone, the way a first fill plans a page:

- An issue **needs an answer** when the page marks it (invalid, or required and still blank), or when one batched Jev question reads its text (linked or nearby) as refusing the answer or saying one is missing rather than helping (a format, a counter, an example). Jev reads the field's label and the text, never the value. The marked fields are planned while that question is asked. That question shows the decision model the field's label, **the answer the field holds** (the extension's display of it, so never a password; clipped to 120 characters) and the text: a rule such as "must be on or after 1/1/1920" refuses an answer only when the answer breaks it, and the model cannot tell without seeing the answer.
- A blank field that needs an answer goes through `FastPlan` as required, so the writer answers it even when the profile is silent.
- A field that holds a refused answer goes through `FastPlan`. A typed answer planned for it is rewritten by the writer with the page's message as its `page error` (or "not accepted" when the page gave none), and a typed step that would send the very value the page refused is dropped. An optional typed field whose answer no profile fact backs is cleared. A choice may be clicked again, since a widget may not have taken the first click.
- Password fields take the account password, as in every plan.
- A blank custom dropdown no field answers is left to the refill's dropdown pass (§9.5).
- Any other issue that needs an answer and gets no step, a fast-refill error, or no decision model: the same request plans the refill with the conversation (`acorn.Refill`, tree plus history). The answer's `refillPlanner` says `fast` or `conversation`. A refill with **no flagged field but page messages** (a page that refuses in plain words) goes straight to the conversation, which reads the messages with the tree ([`refill_system.txt`](../../../acorn-backend/acorn/prompts/refill_system.txt) rule 1b): the blank, unchecked or placeholder-set controls they are about get an answer.

### 13.4 The writer

The writer prompt ([`prose_system.txt`](../../../acorn-backend/acorn/prompts/prose_system.txt)) returns short facts exactly as stored and writes prose answers in the first person, with rules against generic phrasing and a length matched to the question and to the field's limits (`maxLength`, a "0/300" counter). Each field is its own call (≤ 8 in flight, 20 s each), and each call lists the form's other questions so answers do not repeat each other. A Refill passes the page's error message for the field. Note that the prompt's hard rules allow the writer to **invent** employers, dates, metrics, or details when the profile is thin (see §14.4).

### 13.5 Mail search

Described in §10.8. The masking means the decision model never sees a code or a link's token; the extension never logs the value; capture keeps only masked forms.

---

## 14. Data, storage, and privacy

### 14.1 What each party sees

| Data                                                 | Text model                 | Jev                                                                      | Stored server-side                               |
| ---------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Profile facts (name, contact, history, demographics) | yes (applicant JSON)       | yes for choice fields and option picks; no for text-field classification | `acorn_profiles`                                 |
| Page structure and text                              | yes (planner tree)         | yes (page reads, labels, options)                                        | the tab's local log; a support claim if reported |
| Field values on the page                             | in the tree (`value` attr) | only shown values in option decisions                                    | the tab's local log; a support claim if reported |
| Default account password                             | never                      | never                                                                    | `acorn_profiles` (plain text)                    |
| Extension password, OpenRouter key                   | never                      | never                                                                    | `acorn_profiles` (plain text)                    |
| Emailed code / link                                  | never                      | masked / without query                                                   | never (the log hides it)                         |
| Gmail contents                                       | never                      | 10 newest rows; one or two opened emails as masked candidates            | Gmail refresh token in `acorn_gmail_mailboxes`   |

The agent Run (§19) sends the model a **screenshot** of the page and the applicant's `profile.json` instead of the compact tree and the account profile; see §19.8 for who sees what.

### 14.2 How passwords stay out

- The serializer writes `(hidden)` for a password box's value. No page HTML is ever sent: the planner, capture and traces carry the compact tree, labels and addresses only.
- Plans are redacted for display, progress, logs, and server capture (`(hidden)` for fills whose role is `password`).
- The planner prompts never contain the password; the backend inserts it into the plan (`fillPasswords`, the `account_password` fact).
- Trace events show `(hidden)` for password steps.

### 14.3 Retention

- Extension: per-tab state in `chrome.storage.session` (cleared when the browser closes), per-tab logs in IndexedDB (cleared when the tab closes), session token in `chrome.storage.local`, résumé and cover-letter files in IndexedDB `acorn-file-cache` by account (at most 200 MB, the oldest-used dropped first).
- Server: usage rows and profiles until deleted; sessions 30 days; a support claim keeps the log the person submitted with it.

### 14.4 Observations worth knowing

These are facts about the current code that are easy to miss:

1. **Stop before Submit is not reachable from the UI.** [`StopBeforeSubmitSwitch.tsx`](../../extension/src/sidebar/StopBeforeSubmitSwitch.tsx) exists but is not rendered, and the stored default is off, so **Run clicks Submit and sends the application** unless an older version stored the switch as on. Only the e2e test passes `stopBeforeSubmit: true`.
2. **Profile defaults on save.** [`profile.normalize`](../../../acorn-backend/profile/store.go) fills empty answers with defaults on every save: gender Male, orientation Heterosexual, citizenship U.S. Citizen, Hispanic/Latino No, race White, no sponsorship, no disability, not a protected veteran, over 18 Yes, background check Yes, relocate Yes, remote, no travel, notice "Immediately", public trust/clearance None. Applications answer EEO and eligibility questions with these when the user never set them.
3. **The writer may invent.** The prose prompt's hard rules let it make up employers, dates, metrics, and "friction" details when the profile is thin.
4. **Secrets in the profile are plain text** in `acorn_profiles`, and `GET /acorn/profile` returns them (OpenRouter key, default account password, extension password) to any valid session for that account, including support sessions.
5. **The sidebar shows the default account password** in plain text on account steps ("Using default password: …", [`NowCard.tsx`](../../extension/src/sidebar/NowCard.tsx)). Policy §6 says the password never reaches plans, progress, or logs — which holds — but it is displayed in the panel.
6. **Capture is on by default in production** and stores the compact tree, the applicant profile text, prompts, and decisions per tab for 72 h (never page HTML).
7. **Usage detail has no bodies.** Usage rows store no request/response text, so the usage detail view shows its "recorded before request bodies were saved" placeholder.

---

## 15. Docs vs. code: what is out of date

| Document says                                                                                                        | Code does                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| README: the extension follows the site's `acorn_session` cookie; "Sign in on the site, then Continue".               | The extension signs in with the profile email and an **extension password** (`/acorn/auth/extension/signin`). The cookie constant is unused by the extension.                                                                |
| README: a Worker Pool job list; `GET /acorn/jobs` lists jobs; sticky footer with Generate / Fill / Recommend.        | No job list and no `GET /acorn/jobs` route (only `/acorn/jobs/{jobId}…`). The Jobs tab shows only Run / Continue / Stop; nothing sends `acorn:open-worker-job`, so tab-job bindings are only honoured if they already exist. |
| README / policy: a Custom tab with remembered tabs, Generate/Recommend cards.                                        | `CustomPanel` is rendered but unreachable (`#custom` maps to Jobs). Remembered-tab bindings are still used internally by Run to hold the recommended résumé.                                                                 |
| README: generated résumés stored in Firestore.                                                                       | Everything is MongoDB (`acorn_resume_*`).                                                                                                                                                                                    |
| acornapi README: profile is only name/email; résumé generation and recommendation return nothing; no usage metering. | Full profile document; Library recommend, cover letters, and generation are implemented; every call is metered and pushed.                                                                                                   |
| README: Help next to Sign out; sidebar footer shows the version.                                                     | Help is the "Acorn Face guide" item in the account menu; the version is in the Settings drawer subtitle.                                                                                                                     |
| `.env.example`: Auto-Focus default 2 s.                                                                              | `AUTO_FOCUS_DEFAULT_SECONDS = 4`.                                                                                                                                                                                            |
| README: Stop before Submit is a sidebar switch.                                                                      | Not rendered (§14.4).                                                                                                                                                                                                        |

---

## 16. Developing and debugging

```bash
bun install
bun run dev:acorn-api     # acorn-backend on 127.0.0.1:8083 (needs MONGO_URI in acorn-backend/.env)
bun run dev:web           # acorn-frontend on localhost:6005
bun run dev:acorn         # watch-build the extension into acorn/extension/dist
```

Load `acorn/extension/dist` unpacked in `chrome://extensions`, set an OpenRouter key and an extension password on the profile in the site, then sign in from the side panel.

- **Where to look when a run misbehaves:** the tab's **Logs** panel, **Problems** view first, then the run's `decision` entries (why it clicked, waited, or stopped) and the `API` entries (what each model call was sent and answered, how long it took); the downloaded zip's `00-summary.json` gives each run's outcome and reason. The worker console (`[acorn:run] <runId> #<step> <event>`) repeats the run's events, and a support claim carries the same log.
- **Where a fill's time goes:** each `fill:done` / `refill:done` run event carries its phases (`dom`, `resume`, `runtime`, `plan`, `steps`, `late`, `drift`, `leftover`); the `dom:read` trace splits a page read into the page's own parts, and `refill:planner` says whether a refill was planned fast or by the conversation (the server logs why it fell back).
- `VITE_ACORN_DEBUG=true` (development builds) pins the build's API URL.
- **Tests:** `bun run test` runs the TypeScript unit tests (`*.test.ts` in the extension and `@acorn/shared`: account goal order, run step detection, evidence, frame navigation, upload formats, label matching…); `go test ./acorn-backend/...` runs the backend's (selector decisions, fast plan, mail extraction, gateway isolation…).
- **End to end:** `bun run e2e:mock-apply:setup` then `bun run e2e:mock-apply` drives the built extension headless through a local multi-step site (posting → apply dialog → sign-in refused → create account → sign in → four form steps → Review) with Stop before Submit and screenshots each step; `tests/e2e/mock-apply/entries.ts` checks entry-list handling without model calls. It needs the local backend and the test account's OpenRouter key.
- **Version bumps:** any shipped extension change bumps `acorn/extension/package.json` (docs and tests do not).

---

## 17. Glossary

| Term                        | Meaning                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Run**                     | The one-click multi-page apply (§10).                                                                      |
| **Fill / Refill**           | One pass of the fill engine over a page / a pass fixing only what the page flagged (§8).                   |
| **Plan**                    | The planner's JSON: `actions[]`, `forbidden_actions[]`, `validation`, `unresolved_items`.                  |
| **Fast plan**               | The decision-model plan from the field list (§13.3).                                                       |
| **Pure / planner tree**     | Text forms of the serialized DOM sent to models (§7.4).                                                    |
| **Jev**                     | TypeSafe's decision model on OpenRouter; answers typed questions with probabilities.                       |
| **SelectorGateway**         | `acorn-backend/selector`: every "pick one of these" decision, all through Jev.                             |
| **Writer**                  | The text model answering free-text fields and questions.                                                   |
| **Leftover pass**           | Answering dropdowns no plan step answered (§9.5).                                                          |
| **Drift repair**            | Putting back answers the page cleared (§9.6).                                                              |
| **Scope**                   | What a requirement's click opened inside the page (an entry form, a dialog) (§10.9).                       |
| **Detour**                  | Following a requirement to another site or tab and coming back.                                            |
| **Account goal**            | The account step the run works toward: sign in, create, or reset (§10.7).                                  |
| **Remembered / Custom tab** | A tab bound in `acornCustomTabs` with a résumé mode and its recommended or generated résumé.               |
| **Worker Pool job**         | A catalog job bound to a tab in `acornTabJobs` (legacy UI flow).                                           |
| **Library / stack**         | The user's uploaded résumés and cover letters; files with the same title are one stack in several formats. |
| **Usage key**               | The per-tab UUID sent as `X-Acorn-Tab`.                                                                    |
| **Capture**                 | Server-side per-tab process recording, kept 72 h (§12.7).                                                  |

---

## 18. Where to look

| Question                          | Start here                                                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What happens when Run is pressed? | [`sidebar/use-tab-work.ts`](../../extension/src/sidebar/use-tab-work.ts) → [`background/messages/run.ts`](../../extension/src/background/messages/run.ts) → [`pipeline/run-orchestrator.ts`](../../extension/src/pipeline/run-orchestrator.ts) |
| How a page is filled              | [`pipeline/run-pipeline.ts`](../../extension/src/pipeline/run-pipeline.ts), [`@acorn/shared/plan-runner/orchestrator.ts`](../../packages/shared/plan-runner/orchestrator.ts)                                                                   |
| How one control is filled         | [`content/plan-step-runner.ts`](../../extension/src/content/plan-step-runner.ts), [`content/agents/`](../../extension/src/content/agents)                                                                                                      |
| How the page is read              | [`content/dom-serializer.ts`](../../extension/src/content/dom-serializer.ts), [`content/form-fields.ts`](../../extension/src/content/form-fields.ts), [`pipeline/fetch-dom.ts`](../../extension/src/pipeline/fetch-dom.ts)                     |
| Account sign-in / sign-up order   | [`pipeline/account-goal.ts`](../../extension/src/pipeline/account-goal.ts) (+ its test)                                                                                                                                                        |
| Run limits                        | [`pipeline/run-limits.ts`](../../extension/src/pipeline/run-limits.ts)                                                                                                                                                                         |
| Planner prompts                   | [`acorn-backend/acorn/prompts/`](../../../acorn-backend/acorn/prompts)                                                                                                                                                                         |
| Fast planner                      | [`acorn-backend/acorn/fastplan.go`](../../../acorn-backend/acorn/fastplan.go), [`facts.go`](../../../acorn-backend/acorn/facts.go)                                                                                                             |
| Page reads and every Jev question | [`acorn-backend/selector/`](../../../acorn-backend/selector) (`advance.go`, `gateway.go`, `batch.go`, `mail.go`, …)                                                                                                                            |
| Routes                            | [`acorn-backend/acornapi/server.go`](../../../acorn-backend/acornapi/server.go)                                                                                                                                                                |
| Model ids and URLs                | [`backend-core/config/config.go`](../../../backend-core/config/config.go)                                                                                                                                                                      |
| Message and socket names          | [`extension/src/types.ts`](../../extension/src/types.ts), [`acornapi/gateway/gateway.go`](../../../acorn-backend/acornapi/gateway/gateway.go)                                                                                                  |
| Per-tab storage                   | `extension/src/tab-*-session.ts`, [`pipeline/run-checkpoint.ts`](../../extension/src/pipeline/run-checkpoint.ts)                                                                                                                               |

---

## 19. The agent Run (acorn-agent)

The Run in §10 reads the page as a tree, plans fills, and decides with rules and counters in the extension. The **agent Run** replaces that with a loop a person would recognise: look at the page, decide what to do with the mouse and keyboard, do it, look again. It is the Run the sidebar's **Run** button starts unless **Agent Run** is switched off in Settings (`acornAgentMode` in `chrome.storage.local`, on by default); with it off, §10 runs as before. The §10 code stays in place behind that switch.

Written from the code at extension **v1.73.0**. The rest of this document describes the page-reading Run; where §19 differs, §19 describes the agent Run.

### 19.1 The split

| Side                                                      | Does                                                                                                                             | Knows nothing about                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Extension** ([`src/agent/`](../../extension/src/agent)) | Looks (a screenshot, and what the page says about the focused control), acts (real mouse and keyboard events), draws the overlay | What a form is, what to answer, when to stop |
| **acorn-agent** ([`acorn-agent/`](../../../acorn-agent))  | Holds the run's memory, asks the model what to do next, judges whether the last actions worked, ends the run                     | The browser: it never touches a page         |

A change to how the agent decides (the prompt, what it remembers, when it gives up) is a change to acorn-agent only. The extension changes only when the browser needs something new: a new kind of input, a new thing to report about the page.

```text
extension (service worker)                      acorn-agent (this computer)               OpenRouter
  attach debugger ─────────────────────────────────────────────────────────────────────────────
  POST /agent/v1/sessions {url,title} ───────▶ read profile.json + resumes/
  ◀──────────────────────────── {sessionId, resumes}
  loop:
    hide overlay · screenshot · show overlay
    read the focused control
    POST …/step {screenshot, focus, notes, results} ─▶ history + memo ─▶ GPT-6 Luna (image + JSON schema)
    ◀──────────── {status, message, actions[]}  ◀──── {observation, memo, job, status, message, actions}
    perform the actions, in order, with the overlay's cursor
  DELETE …/sessions/{id}
```

### 19.2 The extension side

All in [`acorn/extension/src/agent/`](../../extension/src/agent); the wire types are one definition in [`@acorn/shared/agent-contract`](../../packages/shared/agent-contract.ts).

| Module                                                                                           | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`runner.ts`](../../extension/src/agent/runner.ts)                                               | The loop. Opens the session, looks, asks, acts, ends. Retries a step up to 3 times (2 s, 6 s, 15 s) on a busy model, an unreachable server or a rate limit. Follows a tab the page opens. Writes `agent-*` events to the tab's log (`RunLog`): actions are logged as kind and place, typed text only as a character count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [`tab-session.ts`](../../extension/src/agent/tab-session.ts)                                     | Attaches the debugger and prepares it (file-picker interception, focus emulation, overlay). Auto-accepts JavaScript dialogs and notes them for the next look. Turns the overlay's Stop button, the person ending the debugging from Chrome's bar, and the tab closing into the run's stop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [`capture.ts`](../../extension/src/agent/capture.ts)                                             | Screenshot of the visible page: JPEG quality 70, at most 1280 px wide (a wider page is scaled down; the scale travels with the shot so a point in the screenshot maps back to the page). The clip's scale is divided by `window.devicePixelRatio` (on a Retina screen the browser would otherwise return an image twice the size asked for), and the pixels every coordinate is in are **the image's own size, read from its JPEG header**, not the size asked for. A shot that takes over 8 s is retried once with the tab brought to the front.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [`page-info.ts`](../../extension/src/agent/page-info.ts)                                         | What a screenshot cannot show, read from the control that has focus (through shadow roots and same-origin frames): its label, value, checked state, whether it is required or flagged invalid, and a native list's options. A password's value is replaced by its length.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [`input.ts`](../../extension/src/agent/input.ts), [`keys.ts`](../../extension/src/agent/keys.ts) | Real input through the debugger: mouse move/click (1 to 3 clicks, right button), wheel scroll in steps of at most 600 px, key chords (`Control+a` runs the editing command; punctuation has its own US key codes), typing (text of 240 characters or fewer one key at a time so a page hears key events; longer text or characters with no key are inserted whole).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [`upload.ts`](../../extension/src/agent/upload.ts)                                               | Hands the page a résumé without the system dialog: the click is made, the file picker it opens is intercepted, and the file is set on that input (`File` + `DataTransfer`, then `input` and `change` events). With no picker within 2 s, the file input at or near the clicked point is used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [`executor.ts`](../../extension/src/agent/executor.ts)                                           | Runs a step's actions in order: the cursor glides to the point and the action waits until it arrives (within 6 px, at most 900 ms) before a click; a hover enlarges it. A click that opens a file picker (the session intercepts pickers, so nothing shows) is reported as `opened: "file_picker"` in its result. An action that fails stops the batch; the rest are reported as skipped. Settle pauses: 350 ms after a click or key, 500 ms after a scroll.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [`overlay.ts`](../../extension/src/agent/overlay.ts)                                             | What the person sees on the page: an orange glow around the window edge, Acorn's glowing "A" cursor, and a bar with a **Stop** button. The cursor is copied from the design demo [`demo/demo.html`](../../../demo/demo.html): the same SVG and gradients, drop-shadow glow, pulsing aura, a canvas of sparks it sheds while it moves and bursts (45) when it clicks, and the same motion (each frame it closes a fifth of the distance to its target and tilts up to 45° with its smoothed sideways speed). It stays on screen between actions and steps and keeps its place across a new page; it is hidden for each screenshot and fades back in (180 ms). Drawn by a script in a closed shadow root with no `innerHTML` and no style element (a page's CSP may forbid either), reinstalled on every new document. Its colors are not the demo's (white and pale yellow vanish on a light page, and no single orange reaches 3:1 against both white and black): the outline is drawn as a white halo, a very dark brown edge (`#3b1500`) and a saturated amber body, so one ring always contrasts (edge on white 16:1, halo on black 21:1, body on edge 6.9:1); the sparks blend normally with a dark rim, and the bar is a fixed white-on-near-black pair. `forced-colors` uses the system colors, `prefers-reduced-motion` removes the sparks and shortens the glide. The palette is written out in this module: the page has no design tokens. |
| [`client.ts`](../../extension/src/agent/client.ts)                                               | The server's HTTP routes. A server that is not running is reported as "Can't reach the Acorn agent at …"; the server's own error code is kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [`progress.ts`](../../extension/src/agent/progress.ts)                                           | Turns the run into the sidebar's `PipelineProgress` and `RunReport` (the Now card shows "Step N" and, from the first answer on, **what the run has cost** (`RunProgress.costUsd`, OpenRouter's own figure, with the model calls and screen checks behind it): "Spent so far" while it works, "Spent" once it ends, and a "Spent" tile on the celebration). `need_person` ends as a failed run whose reason is "waited for person"; `stuck` as "no progress"; both carry the server's `stop` (reason, problem, action) as `RunFailure.agentStop`, which the Now card shows as a notice ([`AgentStopNotice.tsx`](../../extension/src/sidebar/AgentStopNotice.tsx)): a "Needs you" or "Couldn't finish" badge, a banner with an icon and a heading for the reason ("Show the page you're not a robot", "Enter the code sent to you", "Add your ID details", "Upload a document", "Sign in to continue", "The page stopped responding", …), the problem in the agent's own plain words, and numbered steps: the action, then "Press Continue, and Acorn picks up where it stopped." An AI error keeps its code for the plain-words message.                                                                                                                                                                                                                                                                                                             |
| [`settings.ts`](../../extension/src/agent/settings.ts)                                           | The server address (`VITE_ACORN_AGENT_URL`) and the Agent Run switch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

[`background/messages/run.ts`](../../extension/src/background/messages/run.ts) starts the agent Run from `START_RUN` when the switch is on. It needs no Acorn sign-in. Stop (`STOP_RUN`, the overlay's button, or Chrome's debugging bar) ends it at once and leaves the page as it is. The manifest already holds the `debugger` permission; it adds the agent's host (`127.0.0.1:8090`, `localhost:8090`).

### 19.3 The server

[`acorn-agent`](../../../acorn-agent) is its own Go module (in `go.work`), with no database. It follows the Go rule: shared model ids and URLs come from `backend-core/config`.

| Package                                                    | Role                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`httpapi`](../../../acorn-agent/httpapi/server.go)        | Routes (below), CORS for the extension, a bound on steps in flight (`ACORN_AGENT_MAX_MODEL_CALLS`, 256), error bodies `{error, code}` with a stable code. Logs method, path, status and step counts, never bodies.                             |
| [`agent`](../../../acorn-agent/agent)                      | The loop's brain: sessions, history, the prompt, answer checking, plans and the checks between their runs ([`checkpoint.go`](../../../acorn-agent/agent/checkpoint.go)), the résumé choice, tracing.                                           |
| [`decide`](../../../acorn-agent/decide/decide.go)          | One call to a decision model (OpenRouter's Decisions API) with a screenshot in the state and yes/no questions; answers are probabilities, output is free; retries 429 and 5xx once.                                                            |
| [`llm`](../../../acorn-agent/llm/openrouter.go)            | One chat call to OpenRouter with images (`image_url` data URLs) and a strict JSON schema; retries 429 and 5xx up to 3 times (honouring `Retry-After`); sums the tokens and cost of every attempt.                                              |
| [`applicant`](../../../acorn-agent/applicant/applicant.go) | `data/profile.json` (any JSON object, up to 256 KB, read as written at the start of every run) and `data/resumes/` (`.pdf .doc .docx .rtf .txt`; a résumé's id is its path in the folder; a path that climbs out of the folder names nothing). |

Routes, all under `/agent/v1`:

| Route                            | Does                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /health`                    | `{ok, model, sessions, hasKey}`; never the key.                                                          |
| `POST /sessions`                 | Opens a run `{url, title, stopBeforeSubmit}` → `{sessionId, resumes[]}`. 401 `no_key`, 422 `no_profile`. |
| `POST /sessions/{id}/step`       | One observation → `{status, message, actions[], number, usage, dropped[]}`.                              |
| `GET /sessions/{id}/resume?id=…` | The résumé file's bytes (type in `Content-Type`, name in `X-File-Name`), for a live session only.        |
| `DELETE /sessions/{id}`          | Ends the run. A session untouched for an hour is dropped.                                                |

The key is the server's `OPENROUTER_API_KEY`, or the `X-OpenRouter-Key` header when the extension sends one.

### 19.4 One step

0. **Is the image the size it says?** The server decodes each screenshot and refuses one whose pixels differ from its viewport by more than one pixel (`bad_observation`, "the screenshot is 2560x1314 pixels but the viewport says 1280x657"): the model measures in the image it is shown, so a mismatch would send every click to the wrong place.
1. **Look.** `Observation`: the screenshot (data URL), the page's address and title, the viewport (screenshot size, scroll position, page size, all in screenshot pixels), the focus report, notes (a dialog that was accepted, a tab the run moved into), and the results of the last step's actions.
2. **Is the page moving?** The server reduces each screenshot to a 32 × 32 brightness grid and compares it with the previous one: the page counts as unchanged when no cell moved by 12 or more (a blinking caret and JPEG noise stay under it; typed text, a message or a new page do not). The model is told "the screen looks the same as after your previous actions" and for how many steps. After `ACORN_AGENT_MAX_STALE` (6) such steps in a row the run ends as `stuck` without another model call. A retried step does not count as an unchanged screen.
3. **Ask.** The request is the system prompt ([`prompts/system.md`](../../../acorn-agent/agent/prompts/system.md), deliberately short: the task, "analyze the screen and do the next thing that gets the application submitted, doing the best you can with what the screenshot and the applicant's details show", the answer format, the actions, the applicant's profile and the résumés), the run's history, and the current look with its screenshot. The model answers in a strict JSON schema: `observation` (what it sees and whether its last actions worked; written before it decides), `memo` (its own notes, at most 2000 characters: the one thing carried from step to step besides the recent screenshots; `null` means unchanged, so it is not written out again), `job`, `status`, `message`, and `actions[]`, each with an optional `check` (19.4a). The first JSON object of the reply is read and what surrounds it (a code fence, a stray character after the brace) is ignored; an answer that is still not that JSON is sent back once with the reason (3 of 47 recorded steps needed that before the parser was made lenient).
4. **Check.** Actions are checked before they leave the server: a point outside the screenshot, text to type that is empty or over 2000 characters, a key that is not one, a scroll of no distance, or more actions than the run allows (12 with checks, 6 without) are refused and listed in `dropped` (which the log shows). A `working` step with nothing usable waits 1 s and looks again.
5. **Act.** The extension performs the actions in order, then looks again. `done`, `need_person` and `stuck` end the run; their actions are dropped.

### 19.4b A click that opens a file picker

A file button clicked with a plain `click` opens the browser's file picker; the extension intercepts it, so nothing is attached and the screenshot shows nothing. Three layers handle it. **The prompt** says to use `upload`, never `click`, for anything that takes a file, and not to use a "type or paste the text" option (the agent has files, not their text). **The result** says it: the executor reports `opened: "file_picker"` and the next look reads "this click opened a file picker that you cannot see, and no file was chosen: to attach a file, use upload at this point". **The server** then acts: it draws the clicked point on the current screenshot and asks the decision model what the marked control takes (`résumé`, `cover letter`, `other`); at 0.90 or more for a résumé (`ACORN_AGENT_CHECK_MATCH_PERCENT`) it sends the résumé upload at that point itself, without a model call, and tells the model afterwards. A cover-letter or other-document control, an unsure answer, a failed check or checks being off leave it to the model, which is told what the control looks like it takes. The agent uploads at a point once. The attempt is a trace entry with `source: "picker"`.

### 19.4c The job description, and which résumé

A screenshot may never show the job description: clicking Apply scrolls straight to the form. So the extension reads the page's visible text on every look and sends it as `pageText` **only when it changed**. It reads **every frame of the tab**: `collectPageText` runs in each frame through `chrome.scripting` (`allFrames`, so a frame of another origin or another process is read by the browser running the script inside it), walking open shadow roots and same-origin frames; frame texts are labelled by host, merged with the top frame first, and a same-origin frame already inside its parent's text is not repeated. Two signs send it deeper: a custom element with no open shadow root (a closed one) and a tab with more frames than a script could enter; then the debugger's DOM view (`DOM.getFlattenedDocument` with `pierce`) adds the text the scripts missed. At most 24 000 characters. Checked in a real browser with the description in a cross-origin frame on another host, a same-origin frame, an open shadow root and a closed one. The server asks **Jev** (text, about $0.00002 a call) one question about it: does this text describe a specific job, not a sign-in page, a bare form, a company page or a list of jobs? At 0.80 or more the first such page becomes the run's job description (at most 12 000 characters), and the model is told it once, on its next look. At most 6 pages are judged per run, each address once; a page of under 400 characters is not asked about. Checked live: a job posting 0.98, a bare application form 0.03, a sign-in page 0.02.

The résumé is then chosen by Jev from **the whole description** (not the model's one-line `job`, which is now also allowed 1 500 characters). If the run reaches a résumé upload with **no** description, it does not guess: it **asks the person, every time**. The Now card shows "Which résumé should Acorn send?" with **Yes, upload [default]** and **I'll choose**. The default is the folder in `DEFAULT_FALLBACK_RESUME` (it must exist, or the run does not start). Yes: the agent sends that résumé at the held point with no model call and tells the model afterwards. I'll choose: the run ends as "Choose your résumé" (reason `resume_choice`) for the person to upload on the page and press Continue. Actions the model planned before the upload run first; those after it do not. A control that takes another document (a cover letter) is never held, a run with a single résumé or no default set is never asked, and nothing is asked once a description was found. The question is a step with `status: "ask"` and an `ask` object; the answer comes back as `answer` in the next observation (`MSG.ANSWER_RUN` from the sidebar to the service worker; Stop ends the wait). A retry before the answer asks again.

**Files only ever come from this computer.** The prompt forbids Dropbox, Google Drive, OneDrive, Box and any other online source, and signing in to one. Only the `upload` action attaches a file. This is a prompt rule (the agent has no list of services to match); a page that opens such a chooser anyway is not blocked by code.

### 19.4d Files only from this computer: the guard

The applicant has not allowed any online file source (a cloud drive, a file-sharing service, signing in to one), so no click may reach one. The prompt says so, but a model can slip, so three things are enforced in code, with no list of services in it (the decision model says what a control or page is, and was right on all 20 realistic cases tried live: Dropbox, Google Drive, an icon-only OneDrive button, a Google Picker frame and an OAuth window all scored 0.91–0.97; Attach, Choose file, Next, Submit, a recaptcha frame, Calendly and an ATS apply window scored 0.02–0.09; "Enter manually" 0.46).

1. **Before a click** (`click`, `double_click`, `triple_click`, `right_click` and `upload`): the executor reads the control under the point from the page (`guard.ts`: through shadow roots and same-origin frames; its text, `aria-label`, `title`, image descriptions, link host, id and classes, and whether it sits in a group around a file input) and the server's `POST /sessions/{id}/vet` asks Jev one question about it. It starts while the cursor glides, so it adds no wait; a plain form field is skipped, and the same description is judged once per run. A probability of `ACORN_AGENT_VET_BLOCK_PERCENT` (30) or more blocks the click: it is never sent, the batch stops, and the model's next look says "blocked: that control uses an online file source… attach a file with upload".
2. **After a click**: a window the click opened is judged (address, title and the start of its text) before the run moves into it, and is closed if it is an online file source or a sign-in to one. A frame of another origin that appears in the page is judged the same way (by address) and removed. Frames are found by sweeping the page after each click and before each screenshot, and by frame events; the sweep is the one that sees a frame of another process.
3. **Fail closed where it matters.** A control the decision model cannot be asked about is blocked when it sits in a file-upload component and let through otherwise; a window or frame that cannot be judged is let be (a failed check must not close every page an application opens). Every decision is a line of `vets.jsonl` in the trace, and costs about $0.00002.

It is a model's judgment, so it cannot be proven complete: an icon-only control with no text, name, image description or class, in no file component, is the case it can miss before the click, and then the window and frame checks are what catch what it opens. The browser tests cover a Dropbox button (refused, never clicked), a window opened by a neutral button (closed) and a frame opened the same way (removed).

### 19.4a Plans and checks

With a decision model configured (the default), the model plans a whole screen at once and puts a `check` on an action: a short description, in its own words, of what the screen should show once that action has run ("First name field shows Stanley"). The prompt asks for one at least every `ACORN_AGENT_CHUNK_ACTIONS` (4) actions. The server cuts the plan into **runs** that end at a check (or at that limit) and sends the first run only. After the extension reports its results and a new screenshot:

1. If a result failed, or the screen did not change, the plan is dropped and the model looks (nothing to check).
2. Otherwise the decision model (`openai/gpt-6-luna-decisions` by default, `ACORN_AGENT_SCREEN_MODEL`) is shown the screenshot and asked three yes/no questions: does it show what the model expected (`matches`), is the page blocked by a popup, overlay, CAPTCHA, sign-in wall or page-level error, not a small validation message beside a field (`blocked`), is it still loading (`loading`).
3. `matches ≥ 0.90`, `blocked ≤ 0.20` and `loading ≤ 0.30` (`ACORN_AGENT_CHECK_MATCH_PERCENT`, `_BLOCKED_PERCENT`, `_LOADING_PERCENT`): the next run is sent **without calling the model** (the person keeps seeing the model's last line). `loading ≥ 0.70`: the agent waits 1 s and checks again, up to 4 times in a row. Anything else, or a checker that fails: the plan is dropped, the model looks, and its next look says how many of its planned actions ran and why the rest did not. A checker that fails once is not used again that run, and plans are then cut to 6 actions.
4. A run whose end has no check ends the plan there: the model looks next and is told the rest did not run. When the plan is used up the model looks and is told it ran in N parts.

The model is the only thing that plans or recovers; the checker only says yes or no. The expectation text, the thresholds and the questions are generic: nothing in them names a site, a vendor or a page's wording. `ACORN_AGENT_CHECKS=false` turns all of this off (plans are then cut to 6 actions and the prompt does not mention checks). A check is recorded in the trace as an entry with `source: "check"` (19.8); its cost is in `Usage.checks` / `checkCost`.

**Actions** (every one is something a person does): `click`, `double_click`, `triple_click`, `right_click`, `hover` (at a point), `type` (into the focused control; `secret` marks a password or code so it is never logged), `key`, `scroll` (at a point, by a distance), `upload` (a résumé, at the control that opens the picker or takes the drop), `wait`.

### 19.5 Memory and context

- **History** is append-only. Every step is replayed exactly as it was sent and answered, screenshots included, and nothing earlier changes between one step and the next. This is what makes the prompt cheap: the provider bills tokens that repeat the start of an earlier prompt at **$0.01 per million instead of $0.125** (19.11), and any change in the middle of a prompt makes everything after it new. The history is compacted only when its estimated size passes `HistoryTokens` (40 000, about 20 steps with screenshots): all but the newest `ACORN_AGENT_KEEP_TURNS` (8) steps are folded into one line each ("step 4: Filled the address [type …; key Tab]", at most 80 lines of 240 characters), and only the newest `ACORN_AGENT_KEEP_IMAGES` (3) keep their screenshot. Then it grows by appending again. There is no second model call for this. (Before this, the oldest step was folded on every step past the eighth and the oldest screenshot dropped, which changed the prompt each time: only the system prompt, about a third of the input, was served from the cache.)
- **Memo.** The model's own scratchpad (19.4) is how the run remembers what is done and what was tried, without relying on what is still on screen. It is told to the model on every step ("Your notes so far") and stays in each replayed step as it was; repeating it costs a hundredth of the normal price once cached, so it is not stripped from older steps (that would change the prompt).
- **Résumé.** (The choice is made from the job description and may ask the person first: 19.4c.) When the model emits an `upload` it usually names no file; the server picks a _stack_ (a folder): a name the model gave if it matches a file, a stack (optionally with a format: "C# + React docx") or a loose document, else the stack chosen earlier in the run, else the only stack, else **Jev** (`typesafe/jev-1.13`) chooses among the stacks by name given the job the model recorded (loose documents are never offered). The stack is sent as a PDF unless a format is named (formats are tried pdf, docx, doc, rtf, txt). If Jev fails the first stack is used and the step's `dropped` says so.
- **Secrets.** The model reads the profile without Acorn's own keys and logins. The account password appears as `{{account_password}}`; when the model types that, the server types the real password and marks the action secret, so the password is in no prompt, history or trace. The OpenRouter key kept in `profile.json` is used only when the server has none of its own.

### 19.6 Stopping, failing, and the person

- **Done.** The model reports `done` once the page shows the application was received. With **Stop before Submit** on it reports `done` at the control that sends it, without clicking, and the run ends as "Ready to submit".
- **Needs the person** only for what the applicant's own hand must give: a CAPTCHA (`captcha`), a code or link sent to them (`verification`), an identity number the profile lacks such as an SSN, driver's license or passport number (`identity`), a document that is not among their files such as a diploma, transcript, ID scan or work permit (`document`), or a sign-in whose password the profile lacks (`sign_in`). The model answers every other question itself: when the profile does not say (worked here before, used this tool, served in the military, may we text you, how did you hear about us) it chooses what most applicants choose and notes it in its memo. With `need_person` or `stuck` it returns `stop: {reason, problem, action}` in plain words; the server adds `no_change` (the page stopped moving) and `step_limit`. The Now card shows it as a notice (19.2). Mail verification is not read by the agent.
- **Stuck.** The model's own report, the unchanged-page limit, or the step limit (`ACORN_AGENT_MAX_STEPS`, 150).
- **Errors.** `no_key`, `invalid_key`, `no_credits`, `rate_limited` and `model_error` map to the same plain-words messages as the rest of Acorn (`@acorn/shared/user-messages`); a server that is not running says so.
- **A new tab.** When a click opens a tab, the run moves into it (the old one stays open), tells the model, and Stop follows.

### 19.7 Configuration

| Variable                                                                                                   | Default                                                        | Meaning                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`                                                                                       | none                                                           | The key the model and Jev are called with.                                                                                                                      |
| `OPENROUTER_BASE_URL`                                                                                      | `config.OpenRouterBaseURL`                                     | For tests: point the model at a stand-in.                                                                                                                       |
| `ACORN_AGENT_MODEL`                                                                                        | `config.OpenRouterModel` (Luna)                                | The model that drives a run.                                                                                                                                    |
| `ACORN_AGENT_REASONING`                                                                                    | `none`                                                         | Reasoning effort sent with each step.                                                                                                                           |
| `ACORN_AGENT_DATA_DIR`                                                                                     | `data`                                                         | Where `profile.json` and `resumes/` are.                                                                                                                        |
| `ACORN_AGENT_TRACE`, `_TRACE_DIR`                                                                          | on, `traces`                                                   | Records each step (below). `ACORN_AGENT_TRACE=false` turns it off.                                                                                              |
| `ACORN_AGENT_MAX_STEPS` · `_MAX_ACTIONS` · `_KEEP_TURNS` · `_KEEP_IMAGES` · `_MAX_STALE`                   | 150 · 12 · 8 · 3 · 6                                           | Bounds on one run (19.4, 19.5). 12 actions apply with checks; without them 6. `_KEEP_TURNS` and `_KEEP_IMAGES` apply when the history is compacted.             |
| `DEFAULT_FALLBACK_RESUME`                                                                                  | none                                                           | The résumé folder offered when a résumé is wanted and no job description was found (19.4c). Must name a folder under `data/resumes`; "" turns the question off. |
| `ACORN_AGENT_CHECKS`                                                                                       | on                                                             | `false` turns the decision-model checks off (19.4a).                                                                                                            |
| `ACORN_AGENT_SCREEN_MODEL` · `_DECISIONS_URL`                                                              | `config.ScreenDecisionModel` · `config.OpenRouterDecisionsURL` | The decision model that checks the screen; the URL is for tests.                                                                                                |
| `ACORN_AGENT_CHUNK_ACTIONS` · `_CHECK_MATCH_PERCENT` · `_CHECK_BLOCKED_PERCENT` · `_CHECK_LOADING_PERCENT` | 4 · 90 · 20 · 30                                               | Most actions between checks, and the thresholds (19.4a).                                                                                                        |
| `HTTP_ADDR`, `CORS_ORIGINS`                                                                                | `127.0.0.1:8090`                                               | Listen address; the extension's own origin is always allowed.                                                                                                   |

### 19.8 Data and privacy

- The screenshot and the shaped `profile.json` (§19.5) go to OpenRouter (the model); the decision model that checks the screen gets the screenshot and the model's own sentence about what it should show (no profile); Jev gets the job text, the shaped profile and the résumé stack names. Nothing goes to acorn-backend, and the extension keeps no copy of the profile.
- A page's password boxes are not hidden from a screenshot: the model sees the dots, and the focus report replaces a password's value with its length. The password the agent types comes from `profile.json`.
- **Traces.** With tracing on (the default), each run writes a folder `traces/<session>/` on this machine, in the order the steps were asked (a retried or failed step is its own numbered entry, never overwritten): `session.json` (the page, model, limits and the résumés on offer), `system.txt` (the standing prompt, the profile with secrets as placeholders), and for every entry `NNN.jpg` (the screenshot the model saw), `NNN.marked.jpg` (the same screenshot with each action's point drawn, numbered in order: red ring and cross for a click, a blue line for a scroll, green for an upload), `NNN.json` (what the page reported, the unchanged-screen count, what the model decided, the actions sent back, those refused and why, the error if the step failed) and `NNN.model.json` (every model call of the step: the messages sent with their images counted, the raw answer, finish reason, tokens, cost, time, requests made). `timeline.txt` is one line per entry to read a run at a glance. Text typed into a field marked `secret` is written as a character count. The folder holds the applicant's pages and is git-ignored. A trace is the recorded run to replay against a change to the agent. The server's own log has one line per step (status, actions, refused, time, cost, message, error).
- The tab's local log (the Logs tab) holds the `agent-*` events: step, status, message, actions as kind and place, failed actions, retries, cost. It holds no screenshots and no typed text.

### 19.9 Tests

- `go test ./acorn-agent/...`: the loop against a scripted model and a scripted decision model (history, folding, repair, lenient parsing, notes told once, plans continued, handed back, waited on, cut at an unchecked run, a failing checker, usage and cost of checks, refusals, unchanged-page detection, résumé choice, secrets in traces, 20 runs at once), the model and decision clients against stand-in servers, the HTTP routes, the applicant files.
- `go run -C acorn-agent ./cmd/tracesum [trace folders]` summarizes recorded runs: model calls and repairs, tokens (and how many the provider served from its cache), checks and their outcomes, cost, seconds, and the time spent outside the model.
- `bun test`: keys, input, screenshot scale, the executor, upload, the server client, the page-side scripts, and the whole loop (a fake browser and server) in [`src/agent/`](../../extension/src/agent).
- `bun run e2e:agent` ([`tests/e2e/agent/run.ts`](../../../tests/e2e/agent/run.ts)): a real browser with the built extension, the real Go server, a form with a native list, a checkbox and a file input, and stand-ins for the model and the decision model. It checks the form received every value, the overlay shows and is removed, the server was sent a screenshot and the applicant, the screenshot's pixels are the viewport the model is told **at two device pixels to a CSS pixel**, Stop works, a planned run is checked and continued by the decision model with two model calls for the whole form, a screen that is not as expected goes back to the model, and a missing server is reported plainly. It brings its own server on a free port and its own build of the extension, so it never touches a server you are running or the extension you have loaded. Real model runs are recorded under `acorn-agent/traces/` and measured in 19.11.

### 19.10 Known gaps

1. **GPT-6 Luna** has completed real applications on real pages (19.11), accepts images, the strict schema (including `check` and a nullable `memo`) and plans actions with checks. Whether `reasoning` other than `none` keeps the JSON in the message is unverified. How often a real plan's runs match what the model expected, and so how many model calls checks save over a whole application, is measured only on recorded pages, not on a complete live run.
2. **Native lists and typeahead.** Clicking a native `<select>` and typing the start of an option selects it in the e2e; ArrowDown then Enter does not. The prompt says to type. Platform differences are untested.
3. **Frames.** The focus report sees the focused control through shadow roots and same-origin frames; a cross-origin frame (an embedded application form) reports no focus. Clicks and typing work there, since they are coordinates.
4. **Mail verification** is not handled: an emailed code or link ends the run as "needs you".
5. **Background tabs** may not draw frames; a screenshot that does not come is retried with the tab brought to the front, which is visible. Many tabs at once is untested.
6. **Résumé choice** reads the stack's folder name, not the résumé's text.
7. **Stop before Submit** relies on the model not clicking the control; nothing outside the model enforces it.
8. **The tab's log holds no screenshots**; they are in the server's trace folder.
9. **The page-reading Run's code is still in the extension** behind the switch (§10).
10. **Checker accuracy** is checked on a handful of real screenshots: it said "blocked" for an ordinary inline validation message until the question was narrowed (19.4a). A false "matches" lets a bad plan run to the end of its run (at most 4 actions); a false "blocked" only costs a model call. The thresholds are untuned.

### 19.11 Cost and time

**Prices** are OpenRouter's catalogue on 2026-10-15 (`GET /api/v1/models`), per million tokens: **GPT-6 Luna** $0.10 input, $0.50 output, $0.01 cache read, $0.125 cache write; **GPT-6 Luna Decisions** $0.10 input and **$0 output**, image input, no cache fee; Jev 1.13 $0.042; cheaper decision models that read images exist (Perplexity pplx-decider and Inception mercury-decide, $0.02).

**What a call really costs.** Fitting the `cost` OpenRouter reports for 11 Luna calls to the token counts, the bill is exactly: tokens served from the prompt cache at $0.01, **every other input token at the write price, $0.125**, output at $0.50. So a token is 12.5 times cheaper when it repeats the start of the previous prompt, and uncached input costs 25% more than the catalogue's input price. The history is therefore append-only (19.5).

**Measured, before this change** (three recorded real runs): 19, 21 and 28 steps (20, 23 and 31 model calls, 6% of them repairs of an invalid answer); 10.0–11.1k input and 230–300 output tokens per call; **$0.0205, $0.0226 and $0.0347** per application (about a third of the input was served from the cache); 4.9–5.4 s per call; wall time **2 m 23 s, 2 m 25 s and 3 m 43 s**, of which 20–25% is the extension acting (about 0.4 s per action and 0.7 s per step). A screenshot is about 1.3k input tokens. The model's notes were only about 60 of its ~250 output tokens per step.

**Measured, append-only history** (8 consecutive real Luna calls on recorded screenshots, no checks): the cached share of the input was 73%, 77%, 82%, 86%, 85%, 87% and 89% from the second call on (each call's cache covered the whole previous prompt); **$0.0004–0.0005 per call against about $0.0011**, 4.2–5.9 s per call (no faster; the wait is the output and a fixed delay). One decision-model check with a screenshot: 1.1–1.6k tokens, **$0.00011–0.00016**, about **0.8 s** from this machine (1.5 s on a cold connection), not 0.1 s.

**Estimates for a 28-step application** (a model fitted to the numbers above, not a measurement of a whole run; re-measure with `cmd/tracesum` after a real run):

| Change                                                                                   | Cost                     | Time (model + extension) |
| ---------------------------------------------------------------------------------------- | ------------------------ | ------------------------ |
| Before                                                                                   | $0.035                   | 3 m 43 s                 |
| Lenient JSON (no repair calls: 31 calls become 28)                                       | −9%                      | −7%                      |
| Append-only history                                                                      | **−45–50%**              | about −4%                |
| Both                                                                                     | **about $0.016–0.018**   | **about 3 m 20 s**       |
| Plans with checks on top (about 21 model calls and 9 checks if Luna plans whole screens) | about the same (±$0.002) | about the same (±10%)    |

Why checks are about neutral: once the prefix is cached a model call costs about $0.0006, so seven avoided calls save about $0.004, but a call that plans a whole screen writes about 220 more output tokens (+$0.0001 and about +2 s each) and the checks cost $0.0014 and 8 s. They pay only if Luna plans long runs, that is, if calls fall by more than about a third. Run with `ACORN_AGENT_CHECKS=false` and with it on, and compare the two traces.

Where the time goes (3 m 43 s): about 75% is model calls (about 5 s each: a fixed delay of about 2.5 s plus about 7 ms per output token), about 25% the extension acting. Only fewer calls, fewer output tokens or a faster executor move it.
