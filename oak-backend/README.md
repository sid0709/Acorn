# athens-backend

NestJS + Prisma API for Athens. Replaces `Athens-server` for the Athens app, starting with authentication and Settings auto-bid profile against MongoDB `AthensDB.account_info`.

## Stack

- NestJS 11
- Prisma 6 (MongoDB — Prisma 7 does not support Mongo yet)
- bcrypt cost 10 (Athens-server contract)
- Acceptance criteria: [`policy-athens-backend.md`](policy-athens-backend.md)
- Logging (Pino + pino-pretty): [`LOGGING.md`](LOGGING.md)

## Setup

```bash
cp .env.example .env
# Set DATABASE_URL — database name must be AthensDB
npm install
npm run prisma:generate
npm run prisma:push
npm run start:dev
```

After every schema change, run generate + push against the target DB (local and VPS). The Docker entrypoint runs `prisma:push` on container start so deploys do not serve a new client against stale indexes.

Default listen: `http://127.0.0.1:8980/api`

### Mongo notes

- Schema and indexes: `prisma/schema.prisma` + `npm run prisma:push`
- Reads use typed Prisma Client via `PrismaService`
- Standalone Mongo (no replica set) cannot run Prisma transactional writes; `AccountInfoRepository` falls back to `$runCommandRaw` for create/password update only. Prefer enabling a replica set in production so typed writes succeed.

## Auth contract (Athens-compatible)

| Method | Path                              | Body                                                                                                                             |
| ------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/signin`                | `{ name, password }`                                                                                                             |
| POST   | `/api/auth/signup`                | `{ name, password }`                                                                                                             |
| POST   | `/api/auth/change-password`       | `{ name, currentPassword, newPassword }`                                                                                         |
| POST   | `/api/auth/delete-account`        | `{ name, password, confirmName }` — cascade wipe (account, resumes, bid history/videos, generator history, mail cache, sessions) |
| POST   | `/api/auth/delete-account/stream` | Same body; SSE `progress` / `done` / `error` events with `{ phase, message, removed, total, percent }`                           |
| POST   | `/api/auth/vendor-password`       | `{ applierName, vendorPassword }` or `{ applierName, clear: true }`                                                              |
| GET    | `/api/account_info`               | —                                                                                                                                |
| GET    | `/api/account_info/by/:name`      | —                                                                                                                                |

Sign-in / sign-up responses: `{ success, user: { _id, name, tier, permission }, message }`.

## Profile contract (Athens-compatible)

| Method | Path                                                     | Notes                                                                           |
| ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/api/personal/auto-bid-profile?applierName=&profileId=` | Returns `{ success, accountExists, vendorAllowed, vendorPasswordSet, profile }` |
| PUT    | `/api/personal/auto-bid-profile`                         | Body: `{ applierName, profileId?, vendorAllowed?, ...profileFields }`           |

Profile secrets (`openaiApiKey`, `deepseekApiKey`, `gmailAppPassword`, `defaultPassword`, …) use local `enc:v1:` via `API_KEYS_ENCRYPTION_KEY` only.

| Method | Path                                                         | Notes                                                                                                         |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/personal/llm-models?provider=&applierName=&profileId=` | OpenAI live catalog (needs key) or DeepSeek (`deepseek-flash` / `deepseek-v4-pro`, live `/models` + fallback) |
| POST   | `/api/personal/default-model`                                | `{ applierName, provider, model, profileId? }` — validates key then saves                                     |
| POST   | `/api/personal/llm-key-check`                                | `{ provider, apiKey?, applierName? }`                                                                         |

## Job Search catalog

| Method | Path                              | Notes                                                                                                                                                                                                            |
| ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/jobs`                       | Query: `status`, `q`, `company`, `source`, `postedFrom`, `postedTo`, `sort`, `aiExtracted`, `page`, `pageSize`, `profileId`                                                                                      |
| GET    | `/api/jobs/:id`                   | Full job (incl. `description`) for View JD. Query: `applierName`, `profileId`                                                                                                                                    |
| GET    | `/api/jobs/:id/viewer-status`     | Reconcile profile status. Query: `applierName`                                                                                                                                                                   |
| POST   | `/api/jobs/apply/bulk`            | Mark jobs applied in `job_statuses` — `{ applierName, jobIds }`                                                                                                                                                  |
| POST   | `/api/jobs/:id/apply`             | Mark applied → upsert `job_statuses.state=applied`                                                                                                                                                               |
| POST   | `/api/jobs/:id/status`            | Body `{ applierName, status: Applied\|Scheduled\|Declined }`                                                                                                                                                     |
| POST   | `/api/jobs/:id/unapply`           | Clear applied → delete `job_statuses` row (back to New)                                                                                                                                                          |
| POST   | `/api/jobs/:id/bid-status`        | Body `{ applierName, status: BidReady\|BidCompleted\|clear }` — `clear` deletes `job_statuses`, `vendor_tasks`, and `bid_review_events` (back to New)                                                            |
| POST   | `/api/jobs/bid-status/bulk`       | Body `{ applierName, status: BidReady\|clear, jobs: [{ id }] }` — `clear` is the same as single-job Move to New                                                                                                  |
| POST   | `/api/jobs/bulk`                  | Extension scrape ingest — `{ jobs: [...] }` → prenorm → dedupe → `temp_jobs`                                                                                                                                     |
| POST   | `/api/expose/jobs`                | LI-scrapper ingest — single job or `{ jobs: [...] }` → prenorm → dedupe → `temp_jobs`                                                                                                                            |
| POST   | `/api/expose/jobs/check`          | LI-scrapper — `{ jobID }` exists in `temp_jobs` or `jobs` via `metadata.legacyId`                                                                                                                                |
| POST   | `/api/jobs/remove`                | Hard-delete catalog `jobs` by `{ ids }` (also clears `job_statuses` + company membership)                                                                                                                        |
| GET    | `/api/company-blocks`             | Admin — list global company block rules (`athens_metadata`)                                                                                                                                                      |
| POST   | `/api/company-blocks`             | Admin — save a company block rule. Body: `{ companyName }`. Header: `x-applier-name`                                                                                                                             |
| DELETE | `/api/company-blocks/:id`         | Admin — remove a block rule (does not delete jobs)                                                                                                                                                               |
| POST   | `/api/company-blocks/search`      | Admin — preview matching `jobs` + `temp_jobs` for a company. Body: `{ companyName }`                                                                                                                             |
| POST   | `/api/company-blocks/remove`      | Admin — hard-delete matching jobs by `{ ids }` (separate from search)                                                                                                                                            |
| POST   | `/api/jobs/company/apply-others`  | Bulk-mark other New roles at a company applied — `{ applierName, companyId, keepJobIds, includeQueued? }`. One status update + one insert. Resolves `companyId` from a keep job when the id is not a 24-char hex |
| POST   | `/api/jobs/company/remove-others` | Hard-delete other roles at a company — `{ companyId, keepJobId }`                                                                                                                                                |
| POST   | `/api/jobs/title-review/remove`   | Hard-delete staging `temp_jobs` by `{ ids, applierName? }`                                                                                                                                                       |

| POST | `/api/jobs/title-review/start` | Body: `{ applierName?, profileId? }` — starts Review Title (profile LLM key) |
| POST | `/api/jobs/title-review/stop` | Abort session + release leases |
| GET | `/api/jobs/title-review` | Paginated title-review list on **temp_jobs**. Query: `tab`, `page`, `limit`, `q`, `sort` |
| GET | `/api/jobs/title-review/bootstrap` | List + live session |
| GET | `/api/jobs/ai-analyze/status` | Live AI Analyze session + pending badge on **temp_jobs** |
| POST | `/api/jobs/ai-analyze/start` | Body: `{ applierName?, profileId? }` — details + skills (profile LLM key) |
| POST | `/api/jobs/ai-analyze/stop` | Abort session + release leases |
| GET | `/api/jobs/skill-extract/status` | Alias of AI Analyze status (legacy client path) |

## Oak (DOM relay + AI action plans)

Oak Chrome extension + UI board authenticate with the same Athens account password as the web app, then call `/api/oak/*` and Socket.io path `/oak` on this process (port 8980). LLM calls use the signed-in profile’s API key + default model; applicant prompt context is sanitized `autoBidProfile` (API keys / app passwords stripped).

| Method | Path                                            | Notes                                                                                                                                                                                                                                                                              |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/oak/auth/signin`                          | `{ name, password }` → Oak Bearer session                                                                                                                                                                                                                                          |
| POST   | `/api/oak/auth/signout`                         | Bearer                                                                                                                                                                                                                                                                             |
| GET    | `/api/oak/auth/me`                              | Bearer                                                                                                                                                                                                                                                                             |
| GET    | `/api/oak/health`                               | Socket client count                                                                                                                                                                                                                                                                |
| POST   | `/api/oak/ai-analyze`                           | Bearer — `{ pureTree, metaTree, page? }` → action plan                                                                                                                                                                                                                             |
| POST   | `/api/oak/match-option`                         | Bearer — dropdown option match                                                                                                                                                                                                                                                     |
| POST   | `/api/oak/qa`                                   | Bearer — `{ question, page? }` → human-like answer (same writer as typing-field fill)                                                                                                                                                                                              |
| GET    | `/api/oak/runtime-file`                         | Bearer — optional file from `OAK_RUNTIME_FILE_PATH`                                                                                                                                                                                                                                |
| GET    | `/api/oak/jobs`                                 | Bearer — Worker Pool jobs for Fill. Each row includes stored `jobDescription` / `hasJobDescription` from `Job.description` (no AI re-extract).                                                                                                                                     |
| GET    | `/api/oak/jobs/:jobId`                          | Bearer — one Worker-pool job including full stored JD for display during generate                                                                                                                                                                                                  |
| POST   | `/api/oak/jobs/:jobId/generate`                 | Bearer — Fill generate from that stored JD + `aiSkills`. Does not call extract-jd. Returns `{ ok, mode: "fill", jobId, inputId, jobDescription, task }` (HTTP 202). Poll/continue on the custom generate routes with that `inputId`.                                               |
| GET    | `/api/oak/jobs/:jobId/resume-preview`           | Bearer — HTML preview of the generated résumé, or the assigned Library Word file                                                                                                                                                                                                   |
| GET    | `/api/oak/jobs/:jobId/recommended-resume`       | Bearer — generated Worker-pool résumé if present, else Job Search Library file                                                                                                                                                                                                     |
| POST   | `/api/oak/custom/analyze-meta`                  | Bearer — Custom JD from the list-item `meta` field `{ meta }` (string or DOM-like tree) → `{ ok, hasJobDescription, jobDescription, reason }`                                                                                                                                      |
| POST   | `/api/oak/custom/extract-jd`                    | Bearer — `{ pageText? }` and/or `{ meta? }`. Same extractor; at least one required. Prefer this or `analyze-meta` for Custom; do not use for Fill.                                                                                                                                 |
| POST   | `/api/oak/custom/generate`                      | Bearer — `{ jobDescription }` (analyzed Custom JD). Same enqueue as My Resume Editor. Returns `{ ok, mode: "custom", inputId, jobDescription, task }`.                                                                                                                             |
| GET    | `/api/oak/custom/generate/:inputId`             | Bearer — poll (202 until complete/failed). Body includes `jobDescription`, `partialSections`, `checkpoint` (`completedIndexes`, `failedStep`, `nextStepIndex`), `canContinue`, `failedStep`, `resumedFromStep`. Completed `result` includes `generationId` and library `resumeId`. |
| POST   | `/api/oak/custom/generate/:inputId/continue`    | Bearer — resume a failed/cancelled run from `failedStep` / `nextStepIndex` without re-running completed steps. HTTP 202 (or 200 when already completed). Returns `{ ok, inputId, recovered, resumedFromStep, jobDescription, task }`.                                              |
| GET    | `/api/oak/custom/resumes/:generationId/preview` | Bearer — HTML of the **stored** templated DOCX (uploaded Word template when selected).                                                                                                                                                                                             |
| GET    | `/api/oak/custom/resumes/:generationId`         | Bearer — that stored library file `{ resumeId, file: { key: custom_resume, name, mimeType, base64 } }` for preview/attach/fill.                                                                                                                                                    |

Oak Custom generate/preview/attach uses the Editor template pipeline and reads the Firebase Storage library row written on generate. Worker-pool **Fill** generate uses the stored job JD (`POST /api/oak/jobs/:jobId/generate`) and writes a job-linked résumé artifact. Custom JD comes from AI analysis of the list-item `meta` field (`POST /api/oak/custom/analyze-meta`), never from re-analyzing a Fill job. There is no second Custom DOCX renderer.

Resume generation checkpoints live on `background_task_inputs.progress` (`checkpointSteps`, `failedStepIndex`) plus `partialSections`. After steps 1–3 succeed and 4 fails, `POST .../generate/:inputId/continue` replays saved outputs and resumes at step 4.

Socket.io: path `/oak`, handshake `auth.token` = Oak access token. Query: `type` (`extension` \| `ui-board`), `name`. Prefer `transports: ['websocket', 'polling']` (polling fallback). Do not point the client at `/socket.io`. Cloud origin is `https://athensai.remotepairnet.net` (host nginx must forward `/oak` websocket upgrades; see `docker/athensai-host-nginx.conf` — not auto-applied by deploy).

See `Oak/README.md` for client setup. Distinct from Jobs **`/api/jobs/ai-analyze`** (temp_jobs skill pipeline).

Admin Fill privileges (`account_info.permission === "admin"`, same gate as Firebase Atlas):

- Fill without a recommended Library resume is admin-only. Non-admin `POST /api/oak/ai-analyze` returns `403` (`OAK_FILL_RESUME_REQUIRED`) when neither a bound Worker-pool job résumé, an owned Custom `page.customGenerationId` résumé, nor a remembered Custom tab (`page.customRemembered`) is available. Resume availability is resolved on the server; client `page.recommendedResumeAvailable` is not trusted.
- Non-admin action plans keep each step with probability `OAK_NON_ADMIN_ACTION_TEMPERATURE` (0.8 ≈ 80% run). Skipped steps are listed in `unresolved_items`. Admins receive the full plan.

## Bid Management + Athens Lens

Mongo owns metadata (`vendor_tasks`, `job_statuses`, `bid_review_events`, `athens_lens_sessions`, `oak_sessions`, `upload_sessions`). Firebase Storage holds video bytes only under `bid-recordings/{applier}/{session}/{uploadId}.{ext}`.

| Method | Path                                                          | Notes                                                                                                                                           |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/jobs/recommend-resumes`                                 | `{ applierName, jobIds[] }` (max 40) — LLM match against analyzed Library resumes (`Resume.title` + `analysis.skills`) → `vendor_tasks`         |
| GET    | `/api/bid-results?applierName=`                               | Bid Management list (date folders via `bidReadyDate`)                                                                                           |
| GET    | `/api/bid-results/rejected`                                   | Rejected only                                                                                                                                   |
| GET    | `/api/bid-results/stats`                                      | KPIs (`since`/`until` optional)                                                                                                                 |
| GET    | `/api/bid-results/recording-url`                              | Signed Storage URL (`path` under `bid-recordings/`)                                                                                             |
| GET    | `/api/bid-results/:id/events`                                 | Review timeline                                                                                                                                 |
| GET    | `/api/bid-results/:id/ai-usage`                               | Ask AI / recommend usage                                                                                                                        |
| PATCH  | `/api/bid-results/:id`                                        | Reviewer status                                                                                                                                 |
| POST   | `/api/bid-results/mark-fixed`                                 | Rejected → submitted                                                                                                                            |
| POST   | `/api/athens-lens/auth/signin`                                | Vendor password → bearer session                                                                                                                |
| POST   | `/api/athens-lens/auth/signout`                               | Revoke session                                                                                                                                  |
| GET    | `/api/athens-lens/jobs`                                       | Bid-ready feed for Lens                                                                                                                         |
| POST   | `/api/athens-lens/ask-ai`                                     | Form answers — SSE when `stream: true` / `Accept: text/event-stream` (`token` / `answers` / `done`); JSON otherwise. Persists when `jobId` set. |
| POST   | `/api/athens-lens/bids/start` / `complete` / `skip`           | Bid lifecycle                                                                                                                                   |
| POST   | `/api/athens-lens/bids/analysis`                              | Persist Ask AI answers                                                                                                                          |
| POST   | `/api/athens-lens/bids/resume-audit`                          | Uploaded resume name audit                                                                                                                      |
| POST   | `/api/athens-lens/bids/recordings/uploads`                    | Begin GCS resumable upload                                                                                                                      |
| POST   | `/api/athens-lens/bids/recordings/uploads/:uploadId/complete` | Validate + attach recording                                                                                                                     |
| GET    | `/api/athens-lens/gmail/messages`                             | Mail list via existing Mail module                                                                                                              |
| GET    | `/api/athens-lens/gmail/message-bodies`                       | Message bodies                                                                                                                                  |

Point athens-lens `WXT_ATHENS_API_URL` (and Athens web API base) at this server — no Lens code changes if the contract matches.

Marking BidReady upserts a `vendor_tasks` stub and sets stable `job_statuses.bidReadyAt` (folder day). Completing a bid sets `bid-completed` without restamping that date.

`GET /api/bid-results` lists the `job_statuses` bid-ready / bid-completed queue (hydrated from `vendor_tasks`). Pending stubs with a `bidReadyDate` but no Bid ready status are junk. Cleanse with `npm run backfill:orphan-vendor-tasks -- --dry-run` then `npm run backfill:orphan-vendor-tasks`.

## Resume library

Binary files: Firebase Storage `{slug(ownerName)}_{profileId}/resumes/{sha256}` (uploads) or `generated-resumes/{generationId}.docx` (Editor / Custom generate). Metadata + analysis: Mongo `resumes`.

| Method | Path                                            | Notes                                                                                |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/api/personal/user-resumes`                    | Query: `ownerName`, `source?`, `profileId?`                                          |
| GET    | `/api/personal/user-resumes/:id`                | Detail + `contentBase64`. Query: `ownerName`                                         |
| POST   | `/api/personal/user-resumes`                    | Single upload (base64 + `techStack` title)                                           |
| POST   | `/api/personal/user-resumes/bulk`               | Bulk → `{ ok, failed }`                                                              |
| PUT    | `/api/personal/user-resumes/:id/primary`        | Body: `{ ownerName }`                                                                |
| DELETE | `/api/personal/user-resumes/:id`                | Query: `ownerName`                                                                   |
| POST   | `/api/personal/user-resumes/:id/clear-analysis` | Clear skills                                                                         |
| POST   | `/api/personal/user-resumes/:id/analyze`        | Start 1-id analyze session                                                           |
| POST   | `/api/resumes/analyze/start`                    | `{ applierName, profileId?, resumeIds, force? }` — WaveBatch parallel skill analysis |
| POST   | `/api/resumes/analyze/stop`                     | Abort session                                                                        |
| GET    | `/api/resumes/analyze/status`                   | Progress per `resumeId`                                                              |

API `techStack` ↔ Mongo `title`. Skills live on each resume in `analysis.skills`. Knob: `RESUME_ANALYZE_BATCH_CONCURRENCY` (default 8).

## Resume Generator (Editor-core)

Persistent config + Skill Coverage + background section generation. Collections: `resume_generator_config`, `resume_generations`, `background_task_inputs`. Uses the profile default LLM key/model. Export is **DOCX only** (no PDF). A completed generate without a Job Search parent job writes that DOCX to Firebase Storage `generated-resumes/{generationId}.docx` and a Mongo library row (`source: generated`); `result.resumeId` is that row.

| Method | Path                                                 | Notes                                                                                       |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/api/personal/resume-generator/config?applierName=` | Load migrated v4 config                                                                     |
| PUT    | `/api/personal/resume-generator/config`              | `{ applierName, config }`                                                                   |
| POST   | `/api/personal/resume-generator/analyze`             | Skill Coverage ledger `{ applierName, jobDescription, identity?, coverage? }`               |
| POST   | `/api/personal/resume-generate`                      | Enqueue `resume_generation` → `{ success, created, inputId, task }` (HTTP 202)              |
| POST   | `/api/personal/resume-generate/:inputId/continue`    | Resume a failed/cancelled run from the saved checkpoint (HTTP 202). `{ applierName }`       |
| GET    | `/api/personal/resume-generation-tasks/:inputId`     | Partial sections, checkpoint (`failedStep`, `canContinue`, `jobDescription`) + final result |
| GET    | `/api/personal/resume-generations`                   | History list (`applierName`, filters, `includeFacets=1`)                                    |
| GET    | `/api/personal/resume-generations/:id`               | Full run                                                                                    |
| GET    | `/api/personal/resume-generations/:id/docx`          | History DOCX (uploaded Word template when selected, else structured export)                 |
| DELETE | `/api/personal/resume-generations/:id`               | Delete run + linked library resume                                                          |
| POST   | `/api/personal/resume-docx`                          | Structured model → DOCX                                                                     |

Background worker also claims `resume_generation` (in addition to `mail_ai_label`).

- Job Search lists **companies**, then hydrates matching jobs. Unfiltered pages `companies` (`lastPostedAt`, `jobIds`). Source-only All-tab filters use denormalized `companies.sourceBuckets` (run `npm run backfill:company-source-buckets` once after deploy). Title, company, posted-date, AI-extracted, and status-tab filters still aggregate projected `jobs` fields. Incomplete title-review / AI Analyze rows live in **`temp_jobs`** and are invisible to search.
- **Ingest** (`SaveJobService`): skip companies in global `athens_metadata.companyBlockRules` (`{ success: true, created: false, blocked: true, code: COMPANY_BLOCKED }`). Then check `temp_jobs` **and** `jobs` for duplicates. Duplicate when `metadata.legacyId` matches, or `applyLink` matches within `JOB_DEDUP_WINDOW_DAYS` (default and floor 14), or `companyName`+`title` match within that window even when the URL differs. Duplicate response stays Extension/LI-compatible: `{ success: true, created: false, duplicate: true, reason, code }` (HTTP 200) — row is **not** added.
- New rows stamp `model_schema_code` from `JOB_MODEL_SCHEMA_CODE` (default `mongodb-athens-2026-08-06`).
- Queue membership is derived from `temp_jobs` (`titleReviewLabel` / `aiSkillStatus` / `metadata.titleReview`). Global company block rules live in `athens_metadata` (`key: global`).
- Review Title must approve a title before AI Analyze (`titleReviewLabel=APPROVED` + open `aiSkillStatus`). AI Analyze writes `metadata.details` + `aiSkills`, then `promoteIfReady`.
- LLM calls use the signed-in profile’s encrypted API key + default model (OpenAI or DeepSeek V4). DeepSeek requests disable thinking for fast JSON batch work. Throughput knobs: `LLM_*` / `JOB_TITLE_REVIEW_*` / `JOB_AI_ANALYZE_*` / `RESUME_ANALYZE_BATCH_CONCURRENCY` / `RECOMMEND_RESUME_CONCURRENCY` in `.env.example`.
- Status tabs filter via `job_statuses` for the given `profileId` (`posted` = jobs with no status row).
- List responses **omit** `description` (lean `select` + `@@index([postedAt])`). Unfiltered totals are cached in-process (~60s). Filtered lists page a projected jobs aggregate (or `companies.sourceBuckets` for source-only All). Status badges count from `job_statuses` intersected with the same attribute match.
- Filters and offset pagination (`page` / `pageSize`) hit Prisma / Mongo against `AthensDB`.
- With `profileId` (`account_info._id`): badge counts aggregate from `job_statuses`; page rows hydrate `viewerStatus` from the same collection (one doc per profile × job). Absence of a row means New (`posted`).
- Response: `{ success, data, pagination, statusCounts, hasMore }`.

## Mail (Gmail IMAP/SMTP)

Uses profile `email` + decrypted `gmailAppPassword`. List responses omit full body (`hasBody: false`); open a message to fetch content. AI label definitions live on `account_info.mailAiLabelDefinitions`.

| Method  | Path                          | Notes                                                                                                                    |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET     | `/api/mail/credentials`       | `{ configured, email? }`                                                                                                 |
| GET     | `/api/mail/labels`            | Custom Gmail labels                                                                                                      |
| POST    | `/api/mail/labels`            | Create label `{ applierName, name, parentId? }`                                                                          |
| DELETE  | `/api/mail/labels/:labelId`   | Delete label                                                                                                             |
| GET     | `/api/mail/threads`           | List (no body). Query: `applierName`, `folder`, `label`, `search`, `unlabeled`, `page`, `pageSize`, `cacheOnly`, `force` |
| GET     | `/api/mail/messages/:uid`     | Full body on open                                                                                                        |
| GET     | `/api/mail/folder-counts`     | Badge totals                                                                                                             |
| POST    | `/api/mail/sync`              | Incremental sync                                                                                                         |
| POST    | `/api/mail/sync/initial`      | Initial page populate                                                                                                    |
| POST    | `/api/mail/sync/older`        | Stub compatible response                                                                                                 |
| POST    | `/api/mail/send`              | SMTP send                                                                                                                |
| PATCH   | `/api/mail/messages/:uid`     | seen / starred / move / labels                                                                                           |
| GET/PUT | `/api/mail/label-definitions` | AI definitions (beta)                                                                                                    |
| POST    | `/api/mail/ai-write`          | Compose AI (beta)                                                                                                        |
| POST    | `/api/mail/ai-label`          | Enqueues `mail_ai_label` background task (beta)                                                                          |

## Background tasks

Embedded worker (`BACKGROUND_WORKERS_MODE=embedded` default locally) claims `mail_ai_label`, `resume_generation`, and `job_worker_pool` tasks. Production Supervisord runs a separate worker process (`BACKGROUND_WORKERS_MODE=worker` on :8981) so the public API (`BACKGROUND_WORKERS_MODE=off`) does not share that heap.

| Method | Path                                      | Notes                                                    |
| ------ | ----------------------------------------- | -------------------------------------------------------- |
| POST   | `/api/background-tasks`                   | `{ type, applierName, profileId?, requestId?, payload }` |
| GET    | `/api/background-tasks`                   | Query: `profileId`, `active`, `limit`                    |
| GET    | `/api/background-tasks/:taskId`           | Public task snapshot                                     |
| POST   | `/api/background-tasks/:taskId/cancel`    | Soft cancel                                              |
| GET    | `/api/background-tasks/events?profileId=` | SSE snapshot / updates / heartbeat                       |

## Analytics reports

| Method | Path                                    | Notes                                                                                                                       |
| ------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/reports/job-source-summary`       | Query: `applierName?`, `startDate?`, `endDate?` → `{ success, data: [{ source, postings, applied, scheduled, declined }] }` |
| GET    | `/api/reports/daily-applications`       | Query: `applierName?`, `startDate?`, `endDate?` → `{ success, data: [{ date, value }] }`                                    |
| GET    | `/api/reports/daily-postings-by-source` | Query: `startDate?`, `endDate?` → `{ success, data: [{ date, source, count }] }` (stacked area chart)                       |

Posting counts use `jobs.postedAt`. Application counts use `job_statuses` for the applier (`updatedAt` in range; states `applied` / `scheduled` / `declined`).

## Firebase Atlas (admin explorer)

Requires header `x-applier-name` with `account_info.permission === "admin"`. Uses Firebase Admin SDK (Firestore + Storage) — not Prisma/Mongo.

| Method | Path                        | Notes                                             |
| ------ | --------------------------- | ------------------------------------------------- |
| GET    | `/api/firebase/status`      | Connectivity + project meta                       |
| GET    | `/api/firebase/collections` | Query: `parent?` (doc path or empty = root)       |
| GET    | `/api/firebase/documents`   | Query: `path`, `limit?`, `cursor?`, `orderField?` |
| GET    | `/api/firebase/document`    | Query: `path`                                     |
| GET    | `/api/firebase/storage`     | Query: `prefix?`, `pageToken?`, `limit?`          |
| GET    | `/api/firebase/storage/url` | Query: `path` → signed read URL                   |
| POST   | `/api/firebase/search`      | Body: `{ path, field, op?, value, limit? }`       |

Env: `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `GOOGLE_APPLICATION_CREDENTIALS` (service-account JSON path).

### Metadata capsule

**Job** (catalog):

```text
{ legacyId?, companyLogo?, details?: { location?, time?, remote?, seniority?, salary? }, titleReview? }
```

**TempJob** (staging ingest, may also include scrape extras):

```text
{
  legacyId?, companyLogo?,
  details?: { location?, time?, remote?, seniority?, salary? },
  titleReview?,
  scrape?: { tags?, companyTags?, skills?, applicants?, duplicateWindowDays? }
}
```

TempJob also has optional top-level `postedAgo` (raw relative text). `registerJob` drops `postedAgo` and `metadata.scrape` when moving into `jobs`.

Legacy keys `companyTags`, `details.position`, `details.money`, and `details.date` are removed by `npm run migrate:temp-jobs`. Align existing temp rows to the ingest schema with `npm run migrate:temp-ingest` (`-- --dry-run` to preview).

### Catalog split (`jobs` vs `temp_jobs`)

| Collection  | Role                                                                                                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobs`      | Searchable catalog. Rows are title-approved **and** skill-pipeline done (`extracted` or `skipped_duplicate`). Strict Prisma `Job` shape.                                                                                                |
| `temp_jobs` | Staging ingest queue (shape ≠ Job). LI-scrapper / Extension land here via prenorm + `saveJob`. Title Review + AI Analyze filter this collection. Promote via `registerJob` / `TempJobPromotionService.promoteIfReady` (move, not copy). |

One-shot reshape + move incomplete catalog rows: `npm run migrate:temp-jobs`. Ingest-schema align: `npm run migrate:temp-ingest`. After adding `sourceBuckets`, stamp existing companies with `npm run backfill:company-source-buckets` (`-- --dry-run` to preview). Indexes come from `prisma:push`.

### Profile-owned status collections

| Collection     | Shape                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job_statuses` | One document per **profile × job** (`profileId` + `jobId` unique). Never shared across users. `state` is `bid-ready` \| `bid-completed` \| `applied` \| `scheduled` \| `declined`. Missing row = New (`posted`). |

Status-tab badges are computed with `groupBy` on `job_statuses` (no denormalized counter collection).

After schema changes: `npm run prisma:generate` and `npm run prisma:push`.

## Verify

```bash
npm run build
npm run lint
```
