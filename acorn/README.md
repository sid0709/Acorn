# Acorn

Chrome extension for capturing page DOM trees, generating structured AI action plans, and running fill automation.

**The backend is `acorn-backend`**, at `https://acornapi.remotepairnet.net` in production: every Acorn route is under `/acorn` (`/acorn/*`) and the Socket.IO gateway is at `/acorn/socket.io`. The Go code lives in [`acorn-backend/acorn`](../acorn-backend/acorn) and [`acorn-backend/acornapi`](../acorn-backend/acornapi/README.md). It was ported from the original TypeScript backend.

Engineering policy: [`policy-acorn.md`](policy-acorn.md). Parent rules: [`../rule.md`](../rule.md).

## Architecture

```
┌─────────────────────┐  socket.io /acorn/socket.io  ┌─────────────────────────┐
│  Chrome Extension   │ ◄─────────────────────────► │  acorn-backend (Go)     │
│  (side panel)       │                             │  acornapi.remotepairnet.net       │
└──────────┬──────────┘       HTTP /acorn/*          │  local: 127.0.0.1:8083  │
           │ fetch DOM                              └─────────────────────────┘
           ▼
    Page DOM tree
```

Auth: Acorn accounts live in acorn-backend and are shared with acorn-frontend. The site keeps the token in the `acorn_session` cookie; the extension reads that cookie and sends it as a bearer token. Signing in or out on the site signs the extension in or out. AI Analyze, Q&A and option matching read the account's name and email. Résumé generation and recommendation are not implemented: those routes answer with no résumé.

## Projects

| Project   | Path                   | Workspace         | Description                                 |
| --------- | ---------------------- | ----------------- | ------------------------------------------- |
| Extension | `extension/`           | `acorn-extension` | Chrome MV3 extension with native side panel |
| Face      | `packages/acorn-face/` | `@acorn/face`     | The animated Acorn Face                     |
| Shared    | `packages/shared/`     | `@acorn/shared`   | Client-side plan/DOM types, API hosts       |

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
bun run build:acorn   # production build: talks to https://acornapi.remotepairnet.net
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `acorn/extension/dist`
4. Sign in on acorn-frontend (http://localhost:6005) in the same browser, open the Acorn sidebar, and choose **Continue**. Acorn follows the `acorn_session` cookie after that.
5. The Acorn API URL is `https://acornapi.remotepairnet.net` in a production build and `http://127.0.0.1:8083` in a development build (both from `@acorn/shared/api`; override with `VITE_ACORN_API_URL` at build time). Keep the side panel open for a green **Socket connected** light — the panel holds a port so Chrome does not park the worker that owns the `/acorn/socket.io` socket. The extension prefers Engine.IO **websocket** with HTTP long-poll fallback (`path: /acorn/socket.io`, `auth.token`). nginx must proxy acornapi.remotepairnet.net to acorn-backend and return 101 on the websocket upgrade (see [`deploy/nginx/acornapi.remotepairnet.net.conf`](../deploy/nginx/acornapi.remotepairnet.net.conf)). Sign-in uses `/acorn/*` and can succeed a moment before the socket turns green. The socket token travels in the handshake `auth` payload only — query-string tokens are rejected, since URLs land in nginx access logs. Every socket joins a room keyed by the signed-in account: `dom:tree`, `pipeline:progress`, `clients:update` and every relayed command (`dom:get-content`, `dom:execute-actions`, `dom:plan-step`) stay inside that room, so a client can only ever see or drive its own account's extension.

### 4. Use it

1. Visit any website
2. Click the Acorn toolbar icon to open the sidebar. The Acorn Face in the identity row and on each list card shows fill/generate status. List cards keep the company logo (Fill) or tab favicon (Custom) with a small acorn badge for that row’s mode. The identity row shows how many tabs are thinking or working. Help (next to Sign out) opens a page of large live faces for every pose.
3. Sign in — Worker pool jobs appear in a Lens-style list
4. Click a job to focus its apply tab if that job is already open, or open the apply URL in a new tab (bound to that tab for Fill)
5. **Fill page / Generate / Recommend** — the sticky footer is Generate, Fill page, and Recommend. In Fill mode Generate and Recommend use the **attached Worker pool job’s stored JD** (not a fresh page extract). Progress, Continue, and View JD live on that job card. Fill uploads the Worker pool résumé, or the file from a Fill Generate/Recommend on that job when one exists.
6. **Custom** — Remember the focused Chrome tab (it stays bound if you switch away and back). Generate, Recommend, and Fill stay disabled until that tab is remembered. The card uses a Acorn Face for status, then title and host in the same layout as Fill. Click a remembered card to focus that Chrome tab; focusing a remembered tab highlights it in the Custom list (same selected color as Fill). Generate and Recommend extract a job description from the same optimized page tree Fill uses for AI Analyze. If the page has no posting, they stop and the card shows **No job description on this page** (or the extract reason). Generate then uses that extracted JD in My Resume’s Editor: same stored config, template, and variables; the template-applied file is stored in Firestore. Recommend matches analyzed Library uploads the same way Job Search Recommend does. After generate finishes, the card shows **Resume generated** and unlocks download and preview. After recommend finishes, the card shows the Library stack name. Before that it shows **Not generated...** or **No resume assigned**, with those actions disabled. Fill’s résumé upload, **View**, and Download use the file for the selected mode (generated Firestore file, or Library recommend). While a résumé is generating, that tab’s card shows a thin segmented progress bar (JD load, summary, skills, experience, save). Recommend uses a two-segment bar (JD, then **Recommending…**). After JD is loaded you can **View JD** on that card. If a step fails, the card keeps the bar and offers **Continue** (resume from the failed step, reuse prior outputs) plus **Start over**. Multiple remembered tabs can generate or recommend at the same time. Generate/Recommend and Fill can run at the same time on different remembered tabs; the same tab cannot run both at once. A new apply tab must be remembered separately.
   **Refill flagged fields** (under Fill page) repairs a fill the site rejected: click the site's Submit / Next first, then Refill. It reads the errors the page shows (ARIA, native validation, and the text inside each field's own wrapper — no per-site rules), sends only those fields to the planner, clears optional fields the profile has no value for (no `N/A` unless the question asks for it), and refills the rest. It never clicks Submit. The result notice says how many fields the page still flags.
7. If Fill leaves a text field blank, open the **Q&A** tab in the sidebar — same human-like writer as Acorn text-field fill. Switching tabs keeps the question and answer. Or drag-select the question on the page: an Acorn chip appears; click it for an in-page answer, then **Copy**.
8. Preview a job’s résumé with the **eye** (left of mark applied) — generated Worker-pool file when present, otherwise the Library Word file assigned in Job Search. Download remains on the card (disabled until a résumé exists). **Mark applied** (check) removes the job from Worker pool and closes its bound apply tab. Custom **check** forgets that remembered tab and closes it.
9. In the sidebar: **Pure Tree**, **Meta Tree**, **AI Analyze**, and the plan-run step list (verified / skipped)

## API (acorn-backend, under `/acorn`)

| Method | Path                                              | Auth                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/acorn/auth/me`                                  | Acorn session (Bearer, or the `acorn_session` cookie)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| POST   | `/acorn/auth/signout`                             | Acorn session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/acorn/health`                                   | — liveness only (`{ ok: true }`); it does not report connected clients                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| POST   | `/acorn/ai-analyze`                               | Bearer — `{ pureTree, page }`. The planner reads the **pure tree only**; control attrs (`role`, `aria-*`, `type`, `name`) **and `class` tokens** ride on each node's `detail`. Class tokens are what distinguish nodes identical by tag and text (a yes/no toggle button from a plain button, the résumé field from an autofill drop zone), so they must stay on the pure tree. `metaTree` is still accepted from older extensions but is not sent to the model. Refill sends `mode: "refill"` and `fieldIssues` (`@acorn/shared/field-issues`); the planner then fixes only those fields and may emit `clear`. |
| POST   | `/acorn/match-option`                             | Bearer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| POST   | `/acorn/qa`                                       | Bearer — leftover-field Q&A (same writer as text fill)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| POST   | `/acorn/debug/log`                                | Bearer — debug builds append step traces to the current debug run; registered only with `ACORN_DEBUG_DIR`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET    | `/acorn/runtime-file`                             | Bearer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| GET    | `/acorn/jobs`                                     | Bearer — Worker Pool jobs (include stored `jobDescription` when present)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| GET    | `/acorn/jobs/:jobId`                              | Bearer — one job, including stored `jobDescription` when the list omits it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/acorn/jobs/:jobId/mark-applied`                 | Bearer — clear Worker pool, then mark applied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/acorn/jobs/:jobId/resume-preview`               | Bearer — HTML preview of the generated résumé, or the assigned Library Word file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| GET    | `/acorn/jobs/:jobId/recommended-resume`           | Bearer — generated Worker-pool résumé if present, else Library file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/acorn/custom/extract-jd`                        | Bearer — `{ pageText }` → `{ hasJobDescription, jobDescription, reason }`. HTTP 200 when no posting (`hasJobDescription: false`). Custom sends the same formatted **pure tree** Fill uses for AI Analyze.                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/acorn/custom/generate`                          | Bearer — `{ jobDescription, jobId?, checkpoint? }` → My Resume Editor generate. `checkpoint` skips completed section steps. Optional `jobId` attaches the file to a Worker pool job. `{ inputId }`                                                                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/acorn/custom/generate/:inputId/continue`        | Bearer — resume a failed generate at `checkpoint.resumeFrom` using saved `partialSections`. 404 → Acorn enqueues a new generate with the same checkpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET    | `/acorn/custom/generate/:inputId`                 | Bearer — poll Custom generate. Completed: `{ status, generationId, resumeId }` (`resumeId` = Firestore file). Running: `{ partialSections, progress }`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| POST   | `/acorn/custom/recommend`                         | Bearer — `{ jobDescription, title?, url? }` → Job Search Library recommend (analyzed uploads). `{ recommendedResumeId, recommendedResumeStack, recommendedResumeReason }`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET    | `/acorn/custom/library-resumes/:resumeId/preview` | Bearer — HTML preview of the recommended Library Word file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| GET    | `/acorn/custom/library-resumes/:resumeId`         | Bearer — `{ file, resumeId, stack }` Library DOCX, same shape as recommended-resume                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GET    | `/acorn/custom/resumes/:generationId/preview`     | Bearer — HTML preview of the **stored** template-applied file (not `renderDocx`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| GET    | `/acorn/custom/resumes/:generationId`             | Bearer — `{ file, generationId, resumeId }` Firestore DOCX, same shape as recommended-resume                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Custom generate backend contract

Acorn does not render a Custom-only résumé. `POST /acorn/custom/generate` must be the same path as My Resume’s Editor:

1. Load the signed-in profile’s stored `ResumeConfig`, DOCX template, and variables.
2. **Fill mode:** use the Worker pool job’s stored `jobDescription`. Do not extract from the page. **Custom mode:** same DOM snapshot as Fill (`fetchDomFromTab` + `formatAnalyzeTrees`), then `POST /acorn/custom/extract-jd` with `pageText` = that formatted pure tree. If `hasJobDescription` is false, stop — do not enqueue.
3. Enqueue editor `resume_generation` with `jobDescription` = that posting prose. If the body includes `checkpoint.resumeFrom` / `partialSections`, skip completed section steps (`summary` / `skills` / `experience`) and continue from `resumeFrom`. `POST .../generate/:inputId/continue` should do the same for an existing task.
4. Optional `jobId` persists the template-applied file onto that Worker pool job (`generatedResume`).
5. Apply that stored template to the generation result.
6. Write the template-applied DOCX to Firestore.
7. Poll returns `generationId` plus `resumeId` of the stored file, plus `partialSections` while running.
8. `GET /acorn/custom/resumes/:generationId` and `/preview` return/convert **that** file.

Acorn persists checkpoints locally (`chrome.storage.session`) per Custom tab and per Worker pool job so Continue works even if the API has not deployed continue yet — JD extract is skipped on Acorn’s side; section skip still needs the checkpoint fields above.

### Custom recommend backend contract

`POST /acorn/custom/recommend` must be the same Library match as Job Search recommend:

1. Call `POST /acorn/custom/extract-jd` first when Custom (same Fill analyze pure tree). Fill Recommend uses the stored job JD and skips extract. If `hasJobDescription` is false, stop.
2. Load the signed-in profile’s analyzed Library catalog (same as Job Search).
3. Run `RecommendOneService.fromPageText` with the extracted posting prose.
4. Resolve `resumeId` from the matched stack label. Do not write `vendor_tasks`.
5. `GET /acorn/custom/library-resumes/:resumeId` and `/preview` return/convert **that** Library file.

Fill (Worker Pool) still uses the Library upload via `GET /acorn/jobs/:jobId/recommended-resume`. Custom Fill in Generate mode uses the generated Firestore file. Custom Fill in Recommend mode uses `GET /acorn/custom/library-resumes/:resumeId`. Do not serve `GET /api/personal/resume-generations/:id/docx` (`renderDocx`, Source Sans, no Skills block) as the Custom generated file.

Socket.io: same host, path `/acorn/socket.io`, handshake `auth.token` = access token.

## Development

```bash
bun run dev:acorn   # from the repo root: watch-build the extension
# Reload unpacked extension in chrome://extensions after changes
```

### Debug capture (local only)

To see exactly what Fill saw and what the AI decided, turn on debug capture on both sides:

1. `acorn-backend/.env`: `ACORN_DEBUG_DIR=./debug-runs`
2. `acorn/.env`: `VITE_ACORN_DEBUG=true`, then build with `bun run dev:acorn` and reload the extension. Production builds (`bun run build:acorn`) ignore the flag, and their build log says so.

Each Fill's Analyze opens `acorn-backend/debug-runs/<time>-<host>-<title>/` with numbered files in capture order: `page.json`, `page.html` (the form frame), `dom-tree.json`, `meta-tree.txt`, `pure-tree.txt` (what the planner reads), `applicant.txt`, one `ai-<purpose>.md` per model call (response, prompts, schema, timing, error), `plan.json`, and `steps.ndjson` (the extension's per-step trace: what each control read before and after, option lists, typed queries, clicks, timeouts, and the leftover pass). Option-match and Q&A calls during that Fill land in the same folder. `POST /acorn/debug/log` only exists while `ACORN_DEBUG_DIR` is set.

Captures hold page HTML and applicant data. They are git-ignored; never enable either flag for a deployed backend or a release build.
