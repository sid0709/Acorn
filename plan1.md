# plan1 — Measure first; pre-caching on hold

Status: plan only. No code has been changed. Implementation starts when the owner says "implement".

**Decision (owner):** the profile/résumé pre-caching is **on hold**. Only **instrumentation** goes ahead. Résumé fetching and recommendation are not the main cause of the slow runs, so nothing is fixed until the measurements say where the time goes.

## Why

The run in `logs/acorn-log-tab1453159523-20261020-091456-826` (v1.89.3) took 333 s for a few form fields and was stopped by the person. From the logs and the code:

| Where the time went       | Time  | Note                                                              |
| ------------------------- | ----- | ----------------------------------------------------------------- |
| Driving-model calls (9)   | 190 s | about 91 s sending the request, about 75 s waiting for the answer |
| Decision-model calls (12) | 49 s  | about 15 s are plan checks, about 33 s are option-list choices    |
| Browser actions           | 50 s  | 19.6 s of it is one `resumeFetch`                                 |
| Session start             | 16 s  | profile and résumé list read from acorn-backend                   |
| Looking at the page       | 7 s   |                                                                   |

- **The request body grows every step.** The body sent to OpenRouter is the system prompt (22 KB), the step texts, and every screenshot kept in the history as base64. It went from 181 KB at step 1 to 842 KB at step 9 (about 4.3 MB for the 9 calls). The history is only compacted past an estimated 30,000 tokens (`agent/session.go`), which this run never reached.
- **Tracing does not enlarge that body.** `OpenRouter.body()` serializes only `req.Messages`. Tracing does add to the agent's reply to the extension (130–250 KB per step instead of about 4 KB), but that hop is on localhost.
- **Send time grows faster than size.** `sendMs` rose from 1.5 s to 24.7 s; throughput fell from about 118 KB/s to about 30 KB/s. The decision calls (a different endpoint) send about 100 KB in 0.35 s. Size alone does not explain it. Candidates: HTTP/2 flow control or the remote side's receive speed, the uplink. This is not yet confirmed.
- **Résumé fetch is not the main cause.** It is 19.6 s of 333 s. The model picks a résumé during the run (14 stacks, pdf and docx), so it cannot all be known and preloaded at start.
- **Several checks wait one after another.** Before the first model call at step 1 there were 3 decision calls and 8.5 s (`learnJD`, `tryNavigate`, and one not yet identified). The plan check after each chunk blocks the next chunk (`agent/checkpoint.go`).

## Phase 0 — Instrumentation (the only work in scope)

Goal: account exactly for the bytes and the time of every hop, so each later change can be compared against a number. Nothing in the run's behavior changes.

### Hops

| Hop | What                                            | Where measured                                                           |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| A   | extension → agent (observation with screenshot) | extension `agent-http` log, already has `requestBytes` / `responseBytes` |
| B   | agent → driving model (OpenRouter)              | `llm/openrouter.go`, `llm/attempt.go`                                    |
| C   | agent → decision model (separate endpoint)      | `decide/decide.go` and `jev` client                                      |
| D   | agent → extension (step reply, with trace)      | extension `agent-http` log                                               |
| E   | résumé file read (extension → agent → backend)  | `agent/resume`, `applicant/backend.go`, backend handler                  |

### What to record

1. **Request body breakdown (B and C), per call:** bytes of system prompt, text of the history, text of the current step, number of images and bytes of each (kept in history vs current), total body bytes, and the estimated history tokens against `HistoryTokens`.
2. **Connection and transfer (B and C):** negotiated protocol (HTTP/1.1 or h2, from `GotConnInfo` / TLS state), connection reused or new, time to first byte written, time to last byte written, bytes per second for the send, time to first response byte, response read time.
3. **Run totals, in the trace summary:** bytes and time per hop (A–E) and per model (driving, decision), the number of calls, and the largest request. `summary.txt` and `00-summary.json` show them.
4. **Résumé fetch (E), split into parts:** extension → agent request time, agent → backend time to first byte, backend database read time and cache hit or miss, bytes, base64 encoding and the attach step in the extension.
5. **Serial waits before a model call:** for each step, the list of calls made before the driving model was asked (name, start, duration), so a chain like `learnJD` → `tryNavigate` → model shows as a timeline.
6. **Chunk checks:** for each plan check, the time from "actions ended" to "next chunk released", split into screenshot capture, upload, decision call, and reply.

### Where it goes

- Go (`acorn-agent`, `acorn-backend`): extend `llm.Attempt` and the trace writer; follow `.claude/rules/go.md` (named constants, `log/slog`, no hardcoded hosts).
- Extension: extend the per-step log entries and the log summary; follow `.claude/rules/vite.md`.
- Keep the cost of measuring near zero: counters and timestamps only, no extra copies of screenshots.

### Done when

- One run produces a single summary that reproduces the numbers in the table above from the logs alone, and says which of the candidate causes for the slow sends (protocol, flow control, uplink) the data supports.
- The `resumeFetch` time is split so the slow part is named.
- Unit tests cover the new counters; `bun run ci` passes for the touched workspaces.
- `acorn/docs/architecture/extension.md` is updated for the new trace fields, and the extension version is bumped (patch).

## After Phase 0 (not decided; shaped by the measurements)

- **Smaller requests:** keep fewer screenshots in the history, compress the screenshots, or both. Compare against the loss of prompt-cache hits and check accuracy on recorded pages.
- **Serial gates:** run independent decision calls before the model call side by side instead of one after another.
- **Option-list choices:** reduce the repeated "list not open" calls.
- **Non-blocking plan checks:** send each chunk's check without waiting and run the next chunk meanwhile; stop at an action boundary on a mismatch. Never run past an upload or a page move. The model marks those boundaries in its plan; no site or wording rules. In this log it would hide at most about 5% of the time, so it comes after the items above.
- **Pre-caching (the original plan1), if still wanted:**
  - Cache per account in the agent, kept fresh by revalidating (ETag / version) rather than by TTL, with the profile and résumé list first.
  - Show progress in the extension at load, with the Run button enabled when ready and a retry / fall back to reading at Run time if it fails.
  - Résumé files: speculative prefetch of the likely candidates while the model chooses, or warming the backend's file cache, instead of preloading every file.
  - Open choices that were left unanswered: gate only the Run button or the whole screen; preload every file or only the main ones.

## Rules to keep

- No fixes before the cause is shown by the measurements.
- No site-specific or wording-specific rules in the agent; use structure and model judgment.
- Live tests only when asked, and only on the Workday link the owner gave. Code, unit tests and CI are the default check.
- Do not commit.
