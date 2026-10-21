# Acorn

Chrome extension that applies to jobs for you: the Run looks at the page as a screenshot and fills the application with real mouse and keyboard events, planned by the Acorn agent (`acorn-agent`).

**The backend is `acorn-backend`**, at `https://api.acornapply.com` in production: every Acorn route is under `/acorn` (`/acorn/*`) and the Socket.IO gateway is at `/acorn/socket.io`. The Go code lives in [`acorn-backend/acorn`](../acorn-backend/acorn) and [`acorn-backend/acornapi`](../acorn-backend/acornapi/README.md). It was ported from the original TypeScript backend.

Engineering policy: [`policy-acorn.md`](policy-acorn.md). Parent rules: [`../rule.md`](../rule.md).

## Architecture

```
┌─────────────────────┐  socket.io /acorn/socket.io  ┌─────────────────────────┐
│  Chrome Extension   │ ◄─────────────────────────► │  acorn-backend (Go)     │
│  (side panel)       │                             │  api.acornapply.com               │
└──────────┬──────────┘       HTTP /acorn/*          │  local: 127.0.0.1:8083  │
           │ screenshot, mouse, keyboard            └─────────────────────────┘
           ▼
    The page (via chrome.debugger)
```

Auth: Acorn accounts live in acorn-backend and are shared with acorn-frontend. The site keeps the token in the `acorn_session` cookie; the extension reads that cookie and sends it as a bearer token. Signing in or out on the site signs the extension in or out. AI Analyze, Q&A and option matching read the account's name and email. Résumé generation and recommendation are not implemented: those routes answer with no résumé.

## Projects

| Project   | Path                   | Workspace         | Description                                 |
| --------- | ---------------------- | ----------------- | ------------------------------------------- |
| Extension | `extension/`           | `acorn-extension` | Chrome MV3 extension with native side panel |
| Face      | `packages/acorn-face/` | `@acorn/face`     | The animated Acorn Face                     |
| Shared    | `packages/shared/`     | `@acorn/shared`   | Agent contract, run types, API hosts        |

They are workspaces of the root bun monorepo: one `bun install` at the repo root, versions from the root catalog, no npm. Run every command below from the repo root.

## Quick Start

### 1. Start the API

acorn-backend needs a `MONGO_URI` (copy `acorn-backend/.env.example` to `acorn-backend/.env`). AI calls use the OpenRouter key saved on the account profile:

```bash
bun run dev:acorn-api   # http://127.0.0.1:8083, Acorn under /acorn
```

### 2. Install

```bash
bun install
```

### 3. Build & load the extension

```bash
bun run dev:acorn     # development build, rebuilt on change: talks to 127.0.0.1:8083 and localhost:6002
bun run build:acorn   # production build: talks to https://api.acornapply.com
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `acorn/extension/dist`
4. Sign in on acorn-frontend (http://localhost:6005) in the same browser, open the Acorn sidebar, and choose **Continue**. Acorn follows the `acorn_session` cookie after that.
5. The Acorn API URL is `https://api.acornapply.com` in a production build and `http://127.0.0.1:8083` in a development build (both from `@acorn/shared/api`; override with `VITE_ACORN_API_URL` at build time). Keep the side panel open for a green **Socket connected** light — the panel holds a port so Chrome does not park the worker that owns the `/acorn/socket.io` socket. The extension prefers Engine.IO **websocket** with HTTP long-poll fallback (`path: /acorn/socket.io`, `auth.token`). nginx must proxy api.acornapply.com to acorn-backend and return 101 on the websocket upgrade (see [`deploy/nginx/api.acornapply.com.conf`](../deploy/nginx/api.acornapply.com.conf)). Sign-in uses `/acorn/*` and can succeed a moment before the socket turns green. The socket token travels in the handshake `auth` payload only — query-string tokens are rejected, since URLs land in nginx access logs. Every socket joins a room keyed by the signed-in account: `pipeline:progress` and `clients:update` stay inside that room, so a client can only ever see its own account's extension. The server also sends `ai-usage:recorded` (`{ tab, entry }`) to that room each time it records an AI call, with `tab` set to the call's `X-Acorn-Tab` key; the worker keeps each tab's list in `chrome.storage.session`, so the side panel shows a tab's calls as they happen and `GET /acorn/ai-usage` (which also returns exact `costNanos` / `totalNanos`) only reconciles.

### 4. Use it

1. Visit a job's application page.
2. Click the Acorn toolbar icon to open the sidebar and sign in with your email and extension password.
3. **Run** on the Jobs tab: the agent looks at the page, opens the application, fills each page from your profile, attaches a résumé from your Library, and stops on the confirmation page, or tells you what it needs (a CAPTCHA, an emailed code, a document) and waits for **Continue**. **Stop** ends it at once, and **Continue** takes it back up where it stopped, with everything it had learned. Details: [`docs/architecture/extension.md`](docs/architecture/extension.md) §19.
4. **Support** and **Logs**: your reports and replies, and the tab's local log of what the Run did.

## API (acorn-backend, under `/acorn`)

| Method | Path                                                         | Auth                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/acorn/auth/me`                                             | Acorn session (Bearer, or the `acorn_session` cookie)                                                                                                                                                                                                                                                       |
| POST   | `/acorn/auth/signout`                                        | Acorn session                                                                                                                                                                                                                                                                                               |
| GET    | `/acorn/health`                                              | — liveness only (`{ ok: true }`); it does not report connected clients                                                                                                                                                                                                                                      |
| POST   | `/acorn/qa`                                                  | Bearer — Q&A: the writer answers one question from the profile                                                                                                                                                                                                                                              |
| POST   | `/acorn/debug/log`, `/acorn/debug/shot`, `/acorn/debug/html` | Bearer — process capture: step traces, screenshots, and page HTML (passwords removed) for the tab's session; see Process capture                                                                                                                                                                            |
| GET    | `/acorn/jobs`                                                | Bearer — Worker Pool jobs (include stored `jobDescription` when present)                                                                                                                                                                                                                                    |
| GET    | `/acorn/jobs/:jobId`                                         | Bearer — one job, including stored `jobDescription` when the list omits it                                                                                                                                                                                                                                  |
| GET    | `/acorn/jobs/:jobId/resume-preview`                          | Bearer — HTML preview of the generated résumé, or the assigned Library Word file                                                                                                                                                                                                                            |
| GET    | `/acorn/jobs/:jobId/recommended-resume`                      | Bearer — generated Worker-pool résumé if present, else Library file                                                                                                                                                                                                                                         |
| POST   | `/acorn/custom/generate`                                     | Bearer — `{ jobDescription, jobId?, checkpoint? }` → My Resume Editor generate. `checkpoint` skips completed section steps. Optional `jobId` attaches the file to a Worker pool job. `{ inputId }`                                                                                                          |
| POST   | `/acorn/custom/generate/:inputId/continue`                   | Bearer — resume a failed generate at `checkpoint.resumeFrom` using saved `partialSections`. 404 → Acorn enqueues a new generate with the same checkpoint.                                                                                                                                                   |
| GET    | `/acorn/custom/generate/:inputId`                            | Bearer — poll Custom generate. Completed: `{ status, generationId, resumeId }` (`resumeId` = Firestore file). Running: `{ partialSections, progress }`                                                                                                                                                      |
| POST   | `/acorn/custom/recommend`                                    | Bearer — `{ jobDescription, title?, url? }` (posting text) → SelectorGateway (Jev) picks the Library upload (analyzed uploads). `{ recommendedResumeId, recommendedResumeStack, recommendedResumeReason }`                                                                                                  |
| POST   | `/acorn/runs`                                                | Bearer — a Run that ended with the application sent: `{ recordId, runId, url, title, endedAt, utcOffsetMinutes, durationMs, costNanos, steps, modelCalls, screenChecks }`. 201 stored; 200 `{ recorded: false }` when `recordId` was already stored; 400 refused. The extension keeps it until this answers |
| GET    | `/acorn/runs`                                                | Bearer — the newest Runs that sent an application (`?limit=`, default 24, at most 100)                                                                                                                                                                                                                      |
| GET    | `/acorn/runs/daily`                                          | Bearer — `?from=YYYY-MM-DD&to=YYYY-MM-DD` (at most 400 days): per day with a Run, `{ day, count, durationMs, costNanos }`                                                                                                                                                                                   |
| GET    | `/acorn/custom/library-resumes/:resumeId/preview`            | Bearer — HTML preview of the recommended Library Word file                                                                                                                                                                                                                                                  |
| GET    | `/acorn/custom/library-resumes/:resumeId`                    | Bearer — `{ file, resumeId, stack }` Library DOCX, same shape as recommended-resume                                                                                                                                                                                                                         |
| GET    | `/acorn/custom/resumes/:generationId/preview`                | Bearer — HTML preview of the **stored** template-applied file (not `renderDocx`)                                                                                                                                                                                                                            |
| GET    | `/acorn/custom/resumes/:generationId`                        | Bearer — `{ file, generationId, resumeId }` Firestore DOCX, same shape as recommended-resume                                                                                                                                                                                                                |

### Custom generate backend contract

Acorn does not render a Custom-only résumé. `POST /acorn/custom/generate` must be the same path as My Resume’s Editor:

1. Load the signed-in profile’s stored `ResumeConfig`, DOCX template, and variables.
2. Use the Worker pool job’s stored `jobDescription`. Do not extract from the page.
3. Enqueue editor `resume_generation` with `jobDescription` = that posting prose. If the body includes `checkpoint.resumeFrom` / `partialSections`, skip completed section steps (`summary` / `skills` / `experience`) and continue from `resumeFrom`. `POST .../generate/:inputId/continue` should do the same for an existing task.
4. Optional `jobId` persists the template-applied file onto that Worker pool job (`generatedResume`).
5. Apply that stored template to the generation result.
6. Write the template-applied DOCX to Firestore.
7. Poll returns `generationId` plus `resumeId` of the stored file, plus `partialSections` while running.
8. `GET /acorn/custom/resumes/:generationId` and `/preview` return/convert **that** file.

Acorn persists checkpoints locally (`chrome.storage.session`) per Worker pool job so Continue works even if the API has not deployed continue yet — JD extract is skipped on Acorn’s side; section skip still needs the checkpoint fields above.

### Custom recommend backend contract

Library files have a kind (`resume` or `cover_letter`; files saved before kinds are résumés). Files of one kind with the same title are one **stack** in several formats: Recommend ranks the stack once, and every Library file comes as the preferred format with the others in `variants`. At upload time the extension sends the version the file input's `accept` list takes, else the format the planner read from the field's words (`value: "pdf" | "word"`), else the PDF. A field that takes only one format never gets another: with no file of that format, the step fails and says which to add.

`POST /acorn/custom/recommend` must be the same Library match as Job Search recommend:

1. Recommend sends the stored job JD (the posting text). No extract-jd call.
2. Load the signed-in profile’s uploaded Library catalog: each file's stack title and analyzed skills.
3. Ask the SelectorGateway (TypeSafe Jev, `typesafe/jev-1.13` on the account's OpenRouter key) in one decision: is this a job posting (else 422 `No job description on this page`), and how probable each upload is. No threshold: the most probable upload is recommended.
4. Return that upload's `resumeId` and `recommendedTop` (top 3 `{ resumeId, stack, probability }`, shown on the On this tab card). Do not write `vendor_tasks`.
5. `GET /acorn/custom/library-resumes/:resumeId` and `/preview` return/convert **that** Library file.

A Worker Pool job's recommended résumé is the Library upload via `GET /acorn/jobs/:jobId/recommended-resume`; a generated one is `GET /acorn/custom/resumes/:generationId`. Do not serve `GET /api/personal/resume-generations/:id/docx` (`renderDocx`, Source Sans, no Skills block) as the generated file.

Socket.io: same host, path `/acorn/socket.io`, handshake `auth.token` = access token.

## Development

```bash
bun run dev:acorn   # from the repo root: watch-build the extension
# Reload unpacked extension in chrome://extensions after changes
```

### End-to-end test

`tests/e2e/agent` drives the built extension, headless, through a local application site with a scripted stand-in for the agent's model, so it needs no OpenRouter key.

```bash
bun run e2e:agent
```

### Update notice

Every deploy packs the extension and records its version on the site (`tools/extension-release.mjs`, `NEXT_PUBLIC_ACORN_EXTENSION_VERSION`). `GET /api/extension/latest` on the site answers `{ version, downloadUrl, installUrl }` (`@acorn/shared/extension-release`). When the sidebar opens, the extension asks it once; if its own version is older, a dialog says so and **Update** opens the download (`/downloads/acorn-chrome.zip`, or the store listing when only that is set). A site that cannot be reached shows nothing.

### Process capture and support reports

Every build captures each tab session's process so a support report can carry it: the extension's step trace (`steps.ndjson`: what each control read before and after, option lists, typed queries, clicks, timeouts, the leftover pass, and every run event), the page HTML of each fill and of each new page (main document and the frame the run reads), `dom-tree.json`, `meta-tree.txt`, `pure-tree.txt`, `applicant.txt`, one `ai-<purpose>.md` per text-model call (response, prompts, schema, timing, error), one `jev-<call>.md` per SelectorGateway decision (the state it read, each question and its options, the answers), each Run decision's request and answer (`run-<id>-NN-read-page.json`, `account-outcome`, `dialog`, `diagnose`, `mail-verification` with the mailbox, the newest emails listed and how Jev ranked them, and any Gmail or token failure), `plan.json`, and screenshots. Passwords never appear: the extension removes them from traces and HTML before anything leaves the page, plans are redacted, and an emailed code or link is kept only masked.

The API keeps capture in MongoDB (`acorn_debug_traces`, gzipped), per user and tab, for 3 days (`debugtrace.SessionRetention`). **Report** copies that tab's whole session (every run folder) onto the claim (`acorn_support_debug_logs`), where it stays with the claim; admins download it as a zip with one folder per run. Build with `VITE_ACORN_CAPTURE=false` to turn the extension's side off.

Locally, `ACORN_DEBUG_DIR=./debug-runs` in `acorn-backend/.env` also writes every run to `acorn-backend/debug-runs/<time>-<host>-<title>/` (git-ignored). `VITE_ACORN_DEBUG=true` in `acorn/.env` with `bun run dev:acorn` adds developer conveniences: the build always talks to `VITE_ACORN_API_URL` (ignoring a URL saved in Settings), and a refused capture upload is shown once in the sidebar ("Debug capture isn't recording"). Screenshots need the tab in front; a skipped one is logged as `screen:skipped`.
