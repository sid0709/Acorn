# Acorn API (Go)

Acorn's HTTP API, in its own service (`acorn-backend`). The `/acorn/*` routes and the `/acorn/socket.io` Socket.IO gateway the Acorn extension talks to. [`cmd/server`](../cmd/server) mounts this package at `acornapi.Prefix`, so in production every route is `https://api.acornapply.com/acorn/...`.

From the repo root:

```bash
cp acorn-backend/.env.example acorn-backend/.env   # MONGO_URI; data goes in AcornDB
bun run dev:acorn-api                              # :8083
go test ./acorn-backend/...
```

## How it works

- **Auth is Acorn's.** `POST /acorn/auth/signup` and `POST /acorn/auth/signin` create an account in `acorn_accounts`. acorn-frontend stores the token in the `acorn_session` cookie, and the extension sends it as `Authorization: Bearer`. `POST /acorn/auth/signout` revokes that session.
- **Profile is the Acorn account.** The planner, writer and Q&A read the account's name and email. Education, demographics, and links are empty until a profile editor exists.
- **The model is the account's.** Every AI call uses that account's OpenRouter key and `openai/gpt-6-luna`. There is no server AI key.
- **Worker pool = saved jobs.** Every run applies to the page in front of it.
- **No résumé gate.** The planner is always told no résumé is available.
- **Résumé generation and recommendation are empty.** `jobs/:id/recommended-resume`, every `*/preview`, `custom/generate` (+ `/continue`, poll), `custom/recommend`, and the `custom/resumes` and `custom/library-resumes` routes keep the extension's contract and return no file, id or match.

## Layout

| Path                             | What                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acorn-backend/acorn`            | Planner, identity classifier, typed-answer writer, option matcher, Q&A, JD extraction. Prompts are extracted verbatim from the TS source into `prompts/*.txt`. |
| `acorn-backend/acornapi/gateway` | Socket.IO at `/acorn/socket.io`: per-account rooms, DOM relay with acks, cross-account isolation.                                                              |
| `acorn-backend/acornapi`         | Routes under `/acorn`, Acorn session handling, Worker pool jobs, empty résumé routes.                                                                          |
