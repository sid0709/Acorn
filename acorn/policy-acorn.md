# Acorn Engineering Policy

Read this file before planning, editing, or reviewing Acorn (`acorn/` and its Go backend). Parent product rules in [`../rule.md`](../rule.md) still apply. This file covers **extension session shape, fill, and Custom**.

---

## 1. Tab-keyed session maps

Chrome tab id is the session key. Persist per-tab maps in `chrome.storage.session` (or the existing tab-session helpers), never a single global “current job” that other tabs overwrite.

- Worker Pool attachments, Custom remembered tabs, fill pipelines, and Custom generate status are all keyed by `tabId`.
- Switching the focused tab must show that tab’s state. Background work on tab A must not disable Generate/Fill on tab B.
- Same tab: fill and generate stay mutually exclusive (both touch that tab’s DOM). Across tabs they may run together.
- Keep the MV3 service worker alive while **any** tab has generate or fill in flight.

---

## 2. Do not create tabs except Worker Pool

`chrome.tabs.create` is for Worker Pool “open this job’s apply URL” only (`open-worker-job.ts`).

Custom **Remember tab** binds the already-focused Chrome tab. Do not open a new tab to remember, generate, or fill Custom.

---

## 3. One fill engine

Shared `plan-runner` is the extension's fill engine. Do not add a second Custom/Worker-Pool fill stack.

Analyze → plan → run steps go through the existing pipeline. Custom Generate vs Library Recommend only changes which résumé file is attached (`custom_resume` vs `recommended_resume`), not the runner.

---

## 4. Custom generate, recommend, and fill

- Custom generate/recommend/fill are keyed by the remembered `tabId`. Starting any of them still requires that remembered tab to be focused.
- Custom has two résumé modes: **Generate** (My Resume Editor pipeline) and **Recommend** (Job Search Library match). The focused remembered tab stores the selected mode.
- **Fill Generate** loads JD from the Worker pool list item’s stored `jobDescription` (already-saved posting prose). Do not re-extract from the apply page. Persist progress on that job id.
- **Custom Generate** extracts a job description from the same DOM snapshot Fill uses for AI Analyze (`fetchDomFromTab` + `formatAnalyzeTrees`). Send that formatted **pure tree** as `pageText` to `POST /acorn/custom/extract-jd`. Enqueue the signed-in **My Resume Editor** pipeline (`ResumeConfig`, stored template, variables) only when `hasJobDescription` is true; the JD param is that extracted prose. If no posting is present, refuse generate. The template-applied DOCX is stored in Firestore. Do not use Job Search `jobId`, and do not use `ResumeGenerationsService.renderDocx` for the file operators download, preview, or attach.
- Recommend posting text: Fill uses the stored job JD; Custom sends the tab's visible page text (same DOM snapshot as Fill, `extractVisiblePageText`) with no extract-jd call. `POST /acorn/custom/recommend` asks the **SelectorGateway** (TypeSafe Jev) in one decision whether that text is a job posting and which analyzed Library upload fits it. Do not persist `vendor_tasks`. If no posting is present or no Library stack matches, refuse recommend. Download, preview, and Fill use that Library file (`recommended_resume`).
- After generate, Fill uploads **that** stored Firestore file. After recommend, Fill uploads the matched Library file. Do not mix the two: mode selects the file.
- Fill is available as soon as the tab is remembered; generate and recommend are not a prerequisite.
- Persist a generate **checkpoint** per list item (completed steps, section outputs, failed step + error). On failure the card offers **Continue**, which resumes from the failed step and reuses prior outputs. **Generate again** / **Start over** still restarts from step 1. Acorn owns `load-jd`; section resume is requested via `checkpoint` on enqueue/continue.

---

## 5. Reuse the existing services

Acorn HTTP in `acorn-backend/acornapi` should compose the existing My Resume Editor generate + apply-template services, and Job Search Library recommend. Do not build a parallel résumé stack, Custom-only DOCX renderer, or a second recommend catalog.

- Custom generate extracts a job description from the same formatted **pure tree** Fill sends to AI Analyze (`POST /acorn/custom/extract-jd` with `pageText` = `formatAnalyzeTrees().pureTree`). Fill generate uses the stored Worker pool `jobDescription` and does not call extract-jd. Enqueue the editor `resume_generation` path only when a JD is present, with the signed-in stored `ResumeConfig`. If no posting is present, refuse generate.
- Generate is five steps: `load-jd`, `summary`, `skills`, `experience`, `finalize`. Acorn persists completed steps and `partialSections`. Continue sends `checkpoint: { completedSteps, resumeFrom, partialSections }` so the API can skip finished AI sections. `POST /acorn/custom/generate/:inputId/continue` is preferred when an `inputId` exists; if that route is missing, enqueue a new generate with the same checkpoint body. Optional `jobId` on generate associates the Firestore file with the Worker pool job.
- On completion, apply the stored template/variables and persist the template-applied DOCX in Firestore (same kind of file the editor uploads to the Library).
- Recommend and dropdown option picks go through the SelectorGateway (`acorn-backend/selector`), which only calls TypeSafe Jev (`typesafe/jev-1.13`, OpenRouter Decisions API, the account's OpenRouter key). Text models write answers; the SelectorGateway only chooses among things that exist. Recommend returns a Library `resumeId`; file download/preview/Fill read **that** Library file.
- The Library keeps résumés and cover letters (`kind`). Files of one kind with the same title are one stack in several formats; Recommend ranks stacks, not files. Fill attaches the stack in the format the upload field takes (its `accept` list, else what its words say), PDF otherwise, and never a format the field refuses. A cover-letter field gets the Library cover letter: the only one, or the best of several by Jev; none leaves the field alone.
- Custom generated-file download, HTML preview, attach, and Fill all read **the Firestore generate file**. Recommend-mode download, preview, attach, and Fill read the Library file. Worker Pool Fill still reads the Library upload (or generated Worker-pool file). Conversion stays on the server (`docxBufferToPreviewHtml` / mammoth) of the stored file, not `ResumeGenerationsService.renderDocx`.
- Do not add a second mammoth in the extension. If a host has not deployed this editor-template path yet, generate / preview / download / Fill must fail clearly — never fall back to the personal `/docx` Source Sans export.

---

## 6. Accounts and emailed verification in Run

- Run goes on without an account whenever the page offers it. When the account is mandatory, it signs in, creates the account, or resets the password with the profile email and the profile's **Default account password**. The order is a fixed mechanism in code (`extension/src/pipeline/account-goal.ts`): create the account, then sign in, and when signing in is refused, reset the password and sign in again. A refusal needs evidence (an alert, a flagged field, new text); a page asking to verify by email means the site took the step. The SelectorGateway only reads which account form the page shows and picks the control that sends or opens the goal's form; the run never matches button wording or DOM.
- The account password is a planner fact (`account_password`) filled straight from the profile. It never reaches a model prompt, the pure tree, field issues, progress, plans shown in the sidebar, or logs (`@acorn/shared/secret-value`). A password box takes nothing else.
- An emailed code or link comes from the connected Gmail through `POST /acorn/run/mail-verification` (`acorn-backend/mailcode`): each look lists the newest 10 inbox emails (rows only); when that list changed, Jev judges all 10 together and only the picked email (then the second best) is opened. Looks repeat until the email arrives or the wait runs out. A code is filled through the plan runner (`verification_code` fact); a link is opened in the run's own tab (`chrome.tabs.update`), never a new one.

---

## 7. Change discipline

- **Bump the Acorn extension version on every shipped change.** It lives only in `extension/package.json`; the build copies it into the manifest, `VITE_ACORN_VERSION`, and the build log. Rules: [`.claude/CLAUDE.md`](.claude/CLAUDE.md), [`.cursor/rules/acorn-versioning.mdc`](.cursor/rules/acorn-versioning.mdc).
- Update `acorn/README.md` when routes or operator steps change.

---

## 8. UI language

Acorn UI follows [`design/README.md`](design/README.md) and [`design/tokens.md`](design/tokens.md). Cursor enforcement: [`.cursor/rules/acorn-ui-design.mdc`](.cursor/rules/acorn-ui-design.mdc).
