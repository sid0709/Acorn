# Oak

Chrome extension + React UI board for capturing page DOM trees, generating structured AI action plans, and running fill automation.

**Backend is `../oak-backend`** (`/api/oak` + Socket.io path `/oak` on port **8980**), on Acorn's accounts, profile and résumé Library. There is no separate Oak Express server.

Engineering policy: [`policy-oak.md`](policy-oak.md).

## Architecture

```
┌─────────────────────┐   socket.io /oak    ┌──────────────────────┐
│  Chrome Extension   │ ◄─────────────────► │  oak-backend          │
│  (side panel)       │                     │  :8980               │
└──────────┬──────────┘   HTTP /api/oak/*   └──────────┬───────────┘
           │ fetch DOM                                 │ broadcast
           ▼                                           ▼
    Page DOM tree                              ┌──────────────────┐
                                               │  React UI Board  │
                                               │  (port 5173)     │
                                               └──────────────────┘
```

Auth: the Acorn email and the **extension password** from the Acorn profile (`POST /api/oak/auth/signin`, which signs in through acorn-backend). The token is an Acorn session, so it works on both backends. AI Analyze uses the profile's OpenRouter key (else OpenAI) and the saved profile, with passwords and keys stripped.

## Projects

| Project   | Path         | Description                                              |
| --------- | ------------ | -------------------------------------------------------- |
| UI Board  | `ui-board/`  | React app with DOM tree visualization + AI Analyze / Run |
| Extension | `extension/` | Chrome MV3 extension with native side panel              |
| Shared    | `shared/`    | Client-side plan/DOM types (not a Nest package)          |

## Quick Start

### 1. Start acorn-backend and oak-backend

acorn-backend handles sign-in. Then, from `oak-backend/`:

```bash
cp .env.example .env   # set ACORN_MONGO_URI
bun install
bun run start:dev
```

The Acorn profile needs an OpenRouter or OpenAI key, an extension password, and at least one Library résumé.

Add the UI board origin to `CORS_ORIGIN` (e.g. `http://localhost:5173`).

### 2. Install Oak clients

```bash
cd Oak
bun install
```

### 3. Start the UI board

```bash
bun run dev:ui-board
```

Open http://localhost:5173 — sign in with your Acorn email and extension password.

Optional: `VITE_ATHENS_API_URL` (oak-backend origin; defaults to `http://127.0.0.1:8980`)

### 4. Build & load the extension

```bash
bun run build:extension
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `extension/dist`
4. Open the Oak sidebar → sign in with the same Acorn email and extension password
5. Confirm the Oak API URL is `http://127.0.0.1:8980` (local default) or your deployed oak-backend (set `VITE_OAK_API_URL` at build time). Keep the side panel open for a green **Socket connected** light — the panel holds a port so Chrome does not park the worker that owns the `/oak` socket. The extension prefers Engine.IO **websocket** with HTTP long-poll fallback (`path: /oak`, `auth.token`). Cloud nginx must proxy `/oak` to port **8980** and return 101 on the websocket upgrade (see `docker/athensai-host-nginx.conf`). Sign-in uses `/api/oak/*` and can succeed a moment before the socket turns green. The socket token travels in the handshake `auth` payload only — query-string tokens are rejected, since URLs land in nginx access logs. Every socket joins a room keyed by the signed-in account: `dom:tree`, `pipeline:progress`, `clients:update` and every relayed command (`dom:get-content`, `dom:execute-actions`, `dom:plan-step`) stay inside that room, so a client can only ever see or drive its own account's extension.

### 5. Use it

1. Visit any website
2. Click the Oak toolbar icon to open the sidebar. The Oak Face in the identity row and on each list card shows fill/generate status. List cards keep the company logo (Fill) or tab favicon (Custom) with a small rabbit badge for that row’s mode. The identity row shows how many tabs are thinking or working. Help (next to Sign out) opens a page of large live faces for every pose.
3. Sign in — Worker pool jobs appear in a Lens-style list
4. Click a job to focus its apply tab if that job is already open, or open the apply URL in a new tab (bound to that tab for Fill)
5. **Fill page / Generate / Recommend** — the sticky footer is Generate, Fill page, and Recommend. In Fill mode Generate and Recommend use the **attached Worker pool job’s stored JD** (not a fresh page extract). Progress, Continue, and View JD live on that job card. Fill uploads the Worker pool résumé, or the file from a Fill Generate/Recommend on that job when one exists.
6. **Custom** — Remember the focused Chrome tab (it stays bound if you switch away and back). Generate, Recommend, and Fill stay disabled until that tab is remembered. The card uses an Oak Face for status, then title and host in the same layout as Fill. Click a remembered card to focus that Chrome tab; focusing a remembered tab highlights it in the Custom list (same selected color as Fill). Generate and Recommend extract a job description from the same optimized page tree Fill uses for AI Analyze. If the page has no posting, they stop and the card shows **No job description on this page** (or the extract reason). Generate then uses that extracted JD in My Resume’s Editor: same stored config, template, and variables; the template-applied file is stored in Firestore. Recommend matches analyzed Library uploads the same way Job Search Recommend does. After generate finishes, the card shows **Resume generated** and unlocks download and preview. After recommend finishes, the card shows the Library stack name. Before that it shows **Not generated...** or **No resume assigned**, with those actions disabled. Fill’s résumé upload, **View**, and Download use the file for the selected mode (generated Firestore file, or Library recommend). While a résumé is generating, that tab’s card shows a thin segmented progress bar (JD load, summary, skills, experience, save). Recommend uses a two-segment bar (JD, then **Recommending…**). After JD is loaded you can **View JD** on that card. If a step fails, the card keeps the bar and offers **Continue** (resume from the failed step, reuse prior outputs) plus **Start over**. Multiple remembered tabs can generate or recommend at the same time. Generate/Recommend and Fill can run at the same time on different remembered tabs; the same tab cannot run both at once. A new apply tab must be remembered separately.
7. If Fill leaves a text field blank, open the **Q&A** tab in the sidebar (or the UI board) — same human-like writer as Oak text-field fill. Switching tabs keeps the question and answer. Or drag-select the question on the page: an Oak chip appears; click it for an in-page answer, then **Copy**.
8. Preview a job’s résumé with the **eye** (left of mark applied) — generated Worker-pool file when present, otherwise the Library Word file assigned in Job Search. Download remains on the card (disabled until a résumé exists). **Mark applied** (check) removes the job from Worker pool and closes its bound apply tab. Custom **check** forgets that remembered tab and closes it.
9. In the sidebar: **Pure Tree**, **Meta Tree**, **AI Analyze**, and the plan-run step list (verified / skipped)
10. **Fetch DOM** still sends a snapshot to the UI board if you want the desktop board

## API

See [`../oak-backend/README.md`](../oak-backend/README.md). The Worker pool list and Custom Generate / Recommend / preview routes are not ported to Acorn yet, so those parts of the sidebar are empty or fail until they are.

Socket.io: same host, path `/oak`, handshake `auth.token` = access token.

## Development

```bash
bun run dev:extension   # watch-build extension
# Reload unpacked extension in chrome://extensions after changes
```
