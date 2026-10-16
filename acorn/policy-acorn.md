# Acorn Engineering Policy

Read this file before planning, editing, or reviewing Acorn (`acorn/` and its Go backend). Parent product rules in [`../rule.md`](../rule.md) still apply. This file covers **extension session shape, fill, and Custom**.

---

## 1. Tab-keyed session maps

Chrome tab id is the session key. Persist per-tab maps in `chrome.storage.session` (or the existing tab-session helpers), never a single global “current job” that other tabs overwrite.

- Worker Pool attachments, Custom remembered tabs, fill pipelines, and Custom generate status are all keyed by `tabId`.
- Switching the focused tab must show that tab’s state. Background work on tab A must not disable Generate/Fill on tab B.
- Same tab: fill and generate stay mutually exclusive (both touch that tab’s DOM). Across tabs they may run together.
- A Run that a click moves into a new tab (an Apply that opens the application there) goes on in that tab and closes the one it left, its log moved along; a requirement's detour keeps its tab, since the run comes back to it. A tab Chrome swaps, or the site closes, is followed to the tab that replaced it or that it opened.
- Keep the MV3 service worker alive while **any** tab has generate or fill in flight.
- A same-origin embedded frame that runs Acorn's own content script (an embedded job board) is read, numbered, and clicked only from inside that frame (`content/frame-reach.ts`). A parent frame reads a child only when the child has no script of its own; content code assumes one realm per frame.

---

## 2. Do not create tabs except Worker Pool

`chrome.tabs.create` is for Worker Pool “open this job’s apply URL” only (`open-worker-job.ts`).

Custom **Remember tab** binds the already-focused Chrome tab. Do not open a new tab to remember, generate, or fill Custom.

---

## 3. One Run

The Run is the **agent Run**: it looks at the page as a screenshot and acts with real mouse and keyboard events, planned by `acorn-agent` (see `docs/architecture/extension.md` §19). It reads the signed-in person's profile and résumés from acorn-backend with their Acorn session (§19.12). It does not create tabs (a tab the page opens is followed, not made), and it holds no per-tab state beyond its debugger session.

Do not add a second way to read or fill a page. The DOM-serializing Run, the plan runner, Fill and Refill, and the in-page control agents were removed in v1.83.0; a change to how a page is filled is a change to the agent (extension `src/agent/` or `acorn-agent/`).

---

## 4. Generate and recommend

- Generate and recommend are keyed by the Worker Pool job bound to the tab. They use the **job's stored `jobDescription`** (already-saved posting prose); never re-extract it from the apply page. Persist progress on that job id.
- `POST /acorn/custom/recommend` asks the **SelectorGateway** (TypeSafe Jev) in one decision whether the text is a job posting and which analyzed Library upload fits it. Do not persist `vendor_tasks`. If no posting is present or no Library stack matches, refuse recommend. Download and preview use that Library file (`recommended_resume`).
- Mode selects the file: after generate, the stored Firestore file; after recommend, the matched Library file. Do not mix the two.
- Persist a generate **checkpoint** per job (completed steps, section outputs, failed step + error). On failure the card offers **Continue**, which resumes from the failed step and reuses prior outputs. **Generate again** / **Start over** still restarts from step 1. Acorn owns `load-jd`; section resume is requested via `checkpoint` on enqueue/continue.

---

## 5. Reuse the existing services

Acorn HTTP in `acorn-backend/acornapi` should compose the existing My Resume Editor generate + apply-template services, and Job Search Library recommend. Do not build a parallel résumé stack, Custom-only DOCX renderer, or a second recommend catalog.

- Generate uses the stored Worker pool `jobDescription` and does not call extract-jd (the route was removed). Enqueue the editor `resume_generation` path only when a JD is present, with the signed-in stored `ResumeConfig`.
- Generate is five steps: `load-jd`, `summary`, `skills`, `experience`, `finalize`. Acorn persists completed steps and `partialSections`. Continue sends `checkpoint: { completedSteps, resumeFrom, partialSections }` so the API can skip finished AI sections. `POST /acorn/custom/generate/:inputId/continue` is preferred when an `inputId` exists; if that route is missing, enqueue a new generate with the same checkpoint body. Optional `jobId` on generate associates the Firestore file with the Worker pool job.
- On completion, apply the stored template/variables and persist the template-applied DOCX in Firestore (same kind of file the editor uploads to the Library).
- Recommend goes through the SelectorGateway (`acorn-backend/selector`), which only calls TypeSafe Jev (`typesafe/jev-1.13`, OpenRouter Decisions API, the account's OpenRouter key). Text models write answers; the SelectorGateway only chooses among things that exist. Recommend returns a Library `resumeId`; file download and preview read **that** Library file.
- The Library keeps résumés and cover letters (`kind`). Files of one kind with the same title are one stack in several formats; Recommend ranks stacks, not files. The agent is told each file's name, kind, and format and chooses the one to attach (`docs/architecture/extension.md` §19.4c).
- A generated file's download and HTML preview read **the Firestore generate file**; a recommended job résumé's read the Library file.
- Do not add a second mammoth in the extension. If a host has not deployed this editor-template path yet, generate / preview / download / Fill must fail clearly — never fall back to the personal `/docx` Source Sans export.

---

## 6. Accounts and emailed verification in Run

- The agent signs in, creates an account, or resets a password on a job site only with the profile email and the profile's **Default account password**, and stops to ask the person when it needs something it cannot get itself (an emailed code, a CAPTCHA, a document): `docs/architecture/extension.md` §19.6.
- The account password never reaches a log: calls are written with passwords, tokens, keys, and codes replaced.
- The page-reading Run's fixed account order, its Gmail search for emailed codes (`POST /acorn/run/mail-verification`, `acorn-backend/mailcode`), and the planner's `account_password` fact were removed in v1.83.0.

---

## 7. The run log

Every run is recorded in the tab's **local log** (Logs tab): step traces with the addresses clicks started from, every backend call with status and latency, and the decisions the run took and why. **The log stays in the browser.** It is not uploaded while a run goes on; it goes to Acorn only when the person submits a support report, attached to that report. The page's HTML never leaves the browser. A password or emailed code never enters the log: calls are written with passwords, tokens, keys and codes replaced. The Run's log also holds its trace: the screenshots, what the model was sent and answered, and per-step timings, returned by the agent in each answer and kept only in this log (the Logs tab's Download puts them in `agent/<run>/`). A support report carries their text, not their pictures. The log keeps each tab's last five runs and at most 50 MB. Writing it never stops or slows a run: entries are built when they are written, not when the run logs them.

---

## 8. Change discipline

- **Bump the Acorn extension version on every shipped change.** It lives only in `extension/package.json`; the build copies it into the manifest, `VITE_ACORN_VERSION`, and the build log. Rules: [`.claude/CLAUDE.md`](.claude/CLAUDE.md), [`.cursor/rules/acorn-versioning.mdc`](.cursor/rules/acorn-versioning.mdc).
- Update `acorn/README.md` when routes or operator steps change.

---

## 9. UI language

Acorn UI follows [`design/README.md`](design/README.md) and [`design/tokens.md`](design/tokens.md). Cursor enforcement: [`.cursor/rules/acorn-ui-design.mdc`](.cursor/rules/acorn-ui-design.mdc).
