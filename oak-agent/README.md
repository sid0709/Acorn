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
5. Confirm the Oak API URL is `http://127.0.0.1:8980` (local default) or your deployed oak-backend (set `VITE_OAK_API_URL` at build time). Keep the side panel open for a green **Socket connected** light — the panel holds a port so Chrome does not park the worker that owns the `/oak` socket. The extension prefers Engine.IO **websocket** with HTTP long-poll fallback (`path: /oak`, `auth.token`). Cloud nginx must proxy `/oak` to port **8980** and return 101 on the websocket upgrade. Sign-in uses `/api/oak/*` and can succeed a moment before the socket turns green. The socket token travels in the handshake `auth` payload only — query-string tokens are rejected, since URLs land in nginx access logs. Every socket joins a room keyed by the signed-in account: `dom:tree`, `pipeline:progress`, `clients:update` and every relayed command (`dom:get-content`, `dom:execute-actions`, `dom:plan-step`) stay inside that room, so a client can only ever see or drive its own account's extension.

### 5. Use it

Oak works on **pages**: Chrome tabs it remembers. One list, one set of buttons.

1. Open a job application in a tab, then open the Oak sidebar (the toolbar icon).
2. **Add this page** (or just press any button below) remembers the tab. Its card shows the Oak Face, the page title and host, the résumé line, and **Cost**, what the models have cost that page so far. Click a card to focus its tab. **×** forgets the page and keeps the tab open.
3. The sticky footer has three buttons for the focused tab:
   - **JD shot** reads the page's DOM tree the same way Fill does and sends it to oak-backend. Jev checks that it is a job posting; if it is, Oak picks the best Library résumé and the card shows **Résumé: <stack>**. If the page has no posting the card says **No job description on this page** and keeps any earlier pick. It is optional: without one, Fill uploads your primary Library résumé.
   - **Fill page** fills the form from your Acorn profile and uploads the picked (or primary) résumé. It never presses submit.
   - **Fill page** and **Sent** are enabled only after a JD shot found a posting on the page, and not while a JD shot, Fill or Sent is running. **Sent** takes a full-page screenshot of the tab (through the Chrome debugger, so Chrome shows its "debugging this tab" banner for a moment), counts the page as sent on your Acorn dashboard with that screenshot, then closes the tab and drops the card. If the upload fails the tab stays open and the card stays.
4. **Cost** is read from the backend (the sum of that tab's `acorn_ai_usage` rows, including the JD shot and Q&A), not estimated in the extension. It refreshes while a step runs and when a step ends.
5. If Fill leaves a text field blank, open the **Q&A** tab in the sidebar (or the UI board) — same human-like writer as Oak text-field fill. Or drag-select the question on the page: an Oak chip appears; click it for an in-page answer, then **Copy**.
6. **Emails** lists the verification emails (codes and verify links) that Acorn's Gmail watcher labelled `oak-verify-email`, newest first, with an unread dot; it reloads each time you open the tab, and **Refresh** reloads it on demand. Click one to read it in full: it is shown on white with its own styling, links open in a new tab. **Remote images are blocked by default** (opening one would tell the sender you read the email); the bar above the message has **Load images**. Pictures embedded in the email always show. The message is read live from Gmail and Oak keeps nothing.
7. In the sidebar: **Pure Tree**, **Meta Tree**, **AI Analyze**, and the plan-run step list (verified / skipped).
8. **Fetch DOM** still sends a snapshot to the UI board if you want the desktop board.

Every request carries `X-Acorn-Tab` (a UUID per Chrome tab, kept in `chrome.storage.session`) and `X-Acorn-Client: oak/<version>`, so the backend can file each model call under its page.

## API

See [`../oak-backend/README.md`](../oak-backend/README.md). The extension calls `/api/oak/ai-analyze`, `match-option`, `qa`, `runtime-file`, `custom/library-resumes/:id`, `jd-shot`, `tab-cost` and `sent`.

Socket.io: same host, path `/oak`, handshake `auth.token` = access token.

## Development

```bash
bun run dev:extension   # watch-build extension
# Reload unpacked extension in chrome://extensions after changes
```
