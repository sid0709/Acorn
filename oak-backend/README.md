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
