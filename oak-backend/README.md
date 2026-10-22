# oak-backend

The API behind the Oak extension (`../oak-agent`): AI action plans for form fill, option matching, Q&A, and the Socket.io relay between the extension and the UI board. It runs on Acorn's accounts and data; it has no database of its own.

## What it reads from Acorn

| Need            | Where                                                                           | Collection                         |
| --------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| Sign-in         | `POST {ACORN_API_URL}/acorn/auth/extension/signin` (email + extension password) | via acorn-backend                  |
| Session check   | SHA-256 of the bearer token, unexpired, account not deactivated                 | `acorn_sessions`, `acorn_accounts` |
| Applicant facts | the profile, minus passwords, keys and local paths                              | `acorn_profiles`                   |
| Model key       | `openrouterApiKey`, else `openaiApiKey`, from that profile                      | `acorn_profiles`                   |
| Résumé file     | primary Library résumé, or one by id                                            | `acorn_resume_library`             |
| Usage           | one row per model call, `client: "oak"`                                         | `acorn_ai_usage`                   |

An Oak token is an Acorn token: the extension signs in once and the same session works on both backends.

## Run

```bash
cp .env.example .env   # set ACORN_MONGO_URI
bun install
bun run start:dev
```

Needs acorn-backend running at `ACORN_API_URL` for sign-in. `bun run build` typechecks and compiles; `bun run lint` lints.

## Routes (`/api/oak`, Socket.io path `/oak`)

| Method | Path                                | Notes                                                           |
| ------ | ----------------------------------- | --------------------------------------------------------------- |
| GET    | `/health`                           | liveness only                                                   |
| POST   | `/auth/signin`                      | `{ email, password }` → `session.accessToken` (the Acorn token) |
| POST   | `/auth/signout`                     | revokes the Acorn session                                       |
| GET    | `/auth/me`                          |                                                                 |
| POST   | `/ai-analyze`                       | `{ pureTree, page }` → action plan                              |
| POST   | `/match-option`                     | pick one option for a value                                     |
| POST   | `/qa`                               | answer one question from the profile                            |
| GET    | `/runtime-file`                     | primary Library résumé                                          |
| GET    | `/custom/library-resumes/:resumeId` | one Library résumé                                              |
| GET    | `/jobs`                             | empty until the Worker pool is ported                           |

Every socket joins a room for its account (`oak:acct:<accountId>`); a client only sees and drives its own account's extension.

## Not ported yet

Worker-pool jobs and mark-applied, and Custom generate / recommend / extract-JD / résumé preview. They were Athens features on Athens data. The extension's Worker pool list is empty and Custom Generate / Recommend will not work until they are rebuilt on Acorn's `acorn_resume_*` collections.

## JD shot, Sent and page cost

| Method | Path        | Notes                                                                                                                                                                                                                                                                                                             |
| ------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/jd-shot`  | `{ pageText }` → `hasJobDescription`, and when true the recommended Library résumé (`resumeId`, `stack`, `matchReason`, `top`). Forwards to acorn-backend's `/acorn/custom/recommend`, where Jev checks the text is a posting; 422 there means "no job description".                                              |
| GET    | `/tab-cost` | `costNanos` and `calls` for the tab named by `X-Acorn-Tab`, summed from `acorn_ai_usage` (Oak's calls and the ones acorn-backend made for the same tab).                                                                                                                                                          |
| POST   | `/sent`     | `{ url, title, durationMs, steps, endedAt?, utcOffsetMinutes, screenshot }` (base64 JPEG). Records a Run through acorn-backend (`POST /acorn/runs`, with the tab's cost) and uploads the screenshot (`PUT /acorn/runs/{id}/screenshot`). The record id is a hash of account, tab and URL, so a retry counts once. |

Every request should carry `X-Acorn-Tab: <uuid per Chrome tab>` and `X-Acorn-Client: oak/<version>`. Oak stamps them on its usage rows and forwards them to acorn-backend, so one tab's cost is one sum. GPT-6 calls go to OpenAI's API and are priced from OpenAI's list rates (cached input tokens at the cached rate); the JD shot's Jev call is the amount OpenRouter billed.

### Upload name

A résumé is served as `<profile name><its own extension>` (`Backend.pdf` → `Eli Taylor.pdf`, `Frontend.docx` → `Eli Taylor.docx`), the way Athens Lens' resume hook renamed uploads. The profile name is `fullName`, else first, middle and last name, else the account name. Anyone looking at the form can tell the right person's file went in, and its type. Characters a file name cannot hold become spaces.

## Emails

| Method | Path                     | Notes                                                                                                                                                                        |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/emails`                | Verification emails the Gmail watcher labelled `oak-verify-email`, across the account's mailboxes, newest first. Forwards to acorn-backend's `GET /acorn/gmail/verify-mail`. |
| GET    | `/emails/:mailboxId/:id` | One of them in full (`html`, `text`, headers, attachment names), read live from Gmail through `GET /acorn/gmail/verify-mail/{mailboxId}/{id}`.                               |

Oak keeps no email content and never logs it. Errors from acorn-backend pass through with their status and `error`.
