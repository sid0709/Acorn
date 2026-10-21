# Fast fill: where it started, what changed, where it stands

Written 2026-10-20. Goal of the work: the image-based Acorn agent (no DOM processing, no per-site rules)
finishes a Greenhouse-style application in about 30 s, accuracy first. The design lives in
[`architecture/extension.md`](architecture/extension.md) section 19.4m; this file is the history and the
current state.

## 1. Before step 0

**Last commit before the fast-fill work: `0721f6b`** (10-20 10:24, extension 1.89.4), "clarify résumé
autofill restrictions and update related tests".

How a run behaved then:

- The model saw one screenshot per look and planned a few actions (the cap was 12) with a check on each.
  A long form took many looks.
- A survey (all screens of the page) existed but was taken in full on every look.
- Dropdowns were opened and chosen one at a time by the legacy `choose` script.
- The history was append-only and only the current screenshot was sent, so the prompt cache worked.
- Measured on the Greenhouse test form:

| When                                                                                | Result                        |
| ----------------------------------------------------------------------------------- | ----------------------------- |
| First logs of this work                                                             | over 5 minutes, not completed |
| After the schema, cache, autofill-rule and logging commits (`33d075d` to `0721f6b`) | 3 min 43 s                    |

Commits that already sat under it and are not part of the steps: `33d075d` (reply schema), `7127442`
(library file cache), `c25feec` (readable logs), `0721f6b` (only a résumé may autofill).

## 2. The plan and the commits

| Step | What                                                                                                                           | Commit                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 0    | Fast-fill switch (`ACORN_AGENT_FAST_FILL`), one flag shared by the agent and the extension                                     | `715a923`                                           |
| 1    | Plan the whole page in one answer: résumé first, up to 60 actions, no checks                                                   | `0e89b72`                                           |
| 2    | Zones (the actions measured on one survey screen) and anchors (a crop of the survey around every target)                       | `126b794`                                           |
| 2b   | Survey badges (screen numbers on the pictures), a point check against the label, slow wheel scrolling, capture without flicker | `3de2b0f`                                           |
| 2c   | Settled parts: the model names screens it will not come back to; painted blue; never scrolled into                             | `67c7460`, `2992d2a` (minimap moved to the sidebar) |
| 3    | A target is found again by its anchor when the page changes height (`POST /locate`)                                            | `1a9ec6d`                                           |
| 4    | Each zone's closing photo is reviewed on the side, field by field (`POST /shots`)                                              | `1a9ec6d`                                           |
| 5    | Dropdowns of a plan are opened and photographed together, read in parallel, then set                                           | `1a9ec6d`                                           |
| 5b   | The blue rule: no scroll into a settled part, page identity by address without `#fragment` or title                            | `1a9ec6d`                                           |

## 3. What is in the working tree now (not committed)

The result of reading the run `279d70b1` (the survey after a résumé upload swept to the top) and added on top
of `1a9ec6d`. Extension 1.92.0.

- **Settled parts survive a height change** above the fence, the page position of the first point the plan
  acts on (`settled.go`, `survey.ts`). Before, any height change of more than 12 px forgot all of them, so
  attaching a résumé (which shortens the form) made the job description be surveyed again.
- **An anchor is two crops**, 640 px wide, one above the point and one below it (`zones.go`, `locate.go`).
  The old single crop above the point held the previous field, which the plan had just filled.
- **A batch that stopped half way** reuses the survey screens above the fence.
- **Skipped actions are one log entry** (`agent-actions:skipped`), not one failure each.
- **Prompt**: aim points where the control is whole and central, `Control+a` before typing into a box that has
  text, do not settle screens a résumé may fill.

Tests: `go test ./...` in `acorn-agent` (with `-race`), Prettier and eslint pass; `tsc` has one error that was
there before (`run-group.ts`). Nothing was run in a real browser by Claude; the run logs come from the user.

## 4. Where it stands

The last run (`383cd8c2`, 13:11:22 to 13:16:13) took **300 s and stopped**, `stuck / no_progress`.

| Part                    | Time                   |
| ----------------------- | ---------------------- |
| 15 main model calls     | 130 s (8.7 s each)     |
| Actions                 | 89 s                   |
| Looking (surveys)       | 39 s                   |
| 42 small decision calls | 53 s (partly parallel) |

What works: surveys after the first are 1 to 4 screens with 4 to 7 settled, nothing sweeps to the top, the
re-find found a target at 0.93 once, flicker is gone, the minimap shows the settled parts.

What does not, with the evidence in that run:

1. **Nothing is typed for 67 s.** Step 1 is the résumé alone; the survey after it is taken before Greenhouse
   has finished autofilling, so step 2's plan is made on a stale page and its Last Name click cannot be found
   again (the page grew 14 px).
2. **Dropdowns fall back to the one-at-a-time script** for a search list ("United States", "Asian"): 52 s and
   68 s blocks of 4 to 5 s steps.
3. **A text box was planned as a dropdown** (the sponsorship question, steps 7 to 9, about 50 s), after the
   point check had refused its point three times.
4. **Submit was pressed too early**, which turned every unanswered question red. After the answers were in,
   Submit was never pressed again; the stale red text was read as a failed entry and the run stopped.
5. **An action made by the probe has no anchor**, so a height change stops the plan (`s10ch20`).

## 5. Next, now in the working tree

Done, in that order, and not yet run on a real form:

- After a résumé upload the extension waits until the page's height stays still (600 ms, at most 8 s)
  before the survey (`upload-settle.ts`).
- The prompt tells the model not to press Submit while a required field is empty, to press it again
  after a change, and to treat red text beside a field that already shows the right value as stale.
- A box with no dropdown arrow is planned as text (click and type), not `choose`. A refused point says
  the same.
- A click the probe or the script makes for a dropdown carries that dropdown's anchor (`carryAnchor`).
- A search box, or a list that is not open on the first picture, is typed and photographed in the probe
  batch. Only a dropdown that still cannot be read after that goes to the one-at-a-time script.

The 30 s goal is not reached: the last measured run (`383cd8c2`) was 300 s, before these changes.

## 6. The run `22394a6e` (1.92.2) and what 1.93.0 does about it

Written 2026-10-20, after the run and before a new one. Nothing below was run in a real browser by Claude: the logic is held by unit tests (Go, and the extension's `tests/`, which run the page scripts against a fake page).

**What the run showed** (Greenhouse, 6,174 px, ended at the e-mail code, which the user's Gmail token could not read):

| Part                 | Time                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| 204 s in all         | model 83 s (13 calls), actions 88 s, looking 31 s (11 surveys)                        |
| The 88 s of actions  | scrolling 30.8, fixed settle sleeps 22.5, waits 9.9, glide 8.6, post-batch settle 6.5 |
| Click, type and keys | 1.9 s of it                                                                           |
| Dropdown handling    | 105 of the 125 actions and 57 s                                                       |

The blue stretches followed the form correctly (six height changes, none forgotten). What cost the time:

1. **Two batches abandoned.** The picture search found no target (0.66 and 0.61; 0.81 and 0.69) because the crops round a target hold the fields the plan had just filled. `abandon` dropped the rest of the plan each time (the model had planned all 24 actions at step 2), and the model was called again (8 s, then 17 s), with the dropdowns probed and set a second and a third time. About 40 s.
2. **The sponsorship question, about 46 s.** The model used `choose` on a text box and aimed at its label; the point check refused the click, dropped it with its text, and the rest of the plan ran, Submit included, twice.
3. **Back and forth.** `bottomUp` ordered dropdowns by the y on their own screen, so the pass went 3470, 5190, 4338, 5190; the first batch of a run of dropdowns was followed by a survey nothing read (three times, about 8 s); every pinned action slept 350 ms after a scroll that did not move (14 of 38 scrolls).

**What 1.93.0 does** (details in [`architecture/extension.md`](architecture/extension.md) 19.4m, _The page's controls_):

- The marks now carry the field box, ids that are the same control wherever it moves, and leave out fixed and sticky controls. The form's moves are a list (several insertions, removals), and what lies where something appeared is no longer settled (before, a message that appeared inside a settled stretch stayed painted blue).
- **A point is bound to its control when it is planned, and follows it.** The page says where the control is, whether the point is on its field, and only then does the action go; otherwise the picture is used as before.
- A refused point that is in a control's field is moved onto the control and checked again; the click that sends the page is held back when the plan lost anything.
- Dropdowns are ordered by their place on the page; the lists are opened top down and picked bottom up; no survey after the first batch of a run.
- No settle after a scroll that did not move; in fast fill an action's pause ends when the page has been quiet for 90 ms (a click at least 150 ms), never later than the fixed pause it replaces.

**Looked at and left alone, on purpose:** the survey's direction (the total travel is the same wherever it ends, except from the middle of a page); the cursor's glide (about 0.1 s a click); the explicit waits of the probe (they cover lists that load as one types); giving the dropdown helpers their zone (the survey after a probe would reuse a photo taken before the pick); a faster wheel for the scroll to an action (it changes what the person sees, and is theirs to decide).

**To measure on the next run:** whether `agent-layout` and `agent-mark` appear and agree with what the page did; how many batches are still abandoned; the `settle` lap against the 22.5 s above; the time of the dropdown passes.

## 7. The run `b3f2aa68` (1.94.0) and what 1.95.0 does about it

Written 2026-10-20, after the run and before a new one. Nothing below was run in a real browser by Claude: the logic is held by unit tests (Go, and the extension's `tests/`, which run the page scripts against a fake page).

**What the run showed** (the same Greenhouse form, 188 s, 11 model calls, 32 decision calls, ended at the e-mail code):

| Cause                                                                                  | Steps | Time  |
| -------------------------------------------------------------------------------------- | ----- | ----- |
| An "Apply" click to reach a form already in the survey; its point check refused (0.01) | 1–2   | ~11 s |
| The plan cut at the résumé upload, then a second plan and survey                       | 3→4   | ~12 s |
| Twelve dropdowns opened, photographed, read and picked one by one                      | 4, 7  | ~42 s |
| The retry ladder for "Asian" (six decision calls, every answer the same), a re-plan    | 5–6   | ~32 s |
| The sponsorship box aimed at its own words inside the box, refused (0.44, 0.61)        | 8     | ~19 s |
| Two more calls and a survey to confirm a stop the page had already explained           | 10–11 | ~11 s |

The disability dropdown's probe click landed on its four-line question and opened nothing; its typed fallback then died on a 70 px growth 1,000 px below it, which the global page-height check took for a moved target. The sponsorship box straddled the 30 px survey overlap and was whole on neither screen.

**What 1.95.0 does** (details in [`architecture/extension.md`](architecture/extension.md) 19.4m, _Aim, labels, lists and the stop_, and 19.4g):

1. Every point of a plan is moved onto its control's entry (the box less its own label, as the page reports it) before the check and the click; a choose on a text box is typed.
2. A point bound to a control the page calls by the model's label is not checked against a picture.
3. A point bound to no control is placed by where the form moved, from the page's controls; the picture is searched only for a point that lies where something appeared.
4. The page names the options of an open list with every look and probe photo. An exact match is picked with no model; the decision model reads the rest as text and takes a best option that leads clearly (`ACORN_AGENT_OPTION_ACCEPT_PERCENT`, 50); nothing is typed into a list that shows options, only into one the page says is open and empty; a list no option of which answers is left to the driving model with its options, in one call for all of them, while the rest of the run goes on and the click that sends the page is held back.
5. A fast-fill plan goes on past an upload.
6. A survey's screens begin above any control their top edge would cut.
7. The marker is an open ring with a dot: the checker reads what is under it.
8. A stop stands at once when the page reports no invalid control and every empty one appeared after the click that sent the page went through.
9. Prompt: aim at the value line, never at the question's words; answer in the option's own words; plan the whole page, upload included; fill a form that is already in the survey.

The trace now records how many controls came with each look and which control each point was bound to (`marks`, `bound` in `NNN.json`), and the log's `agent-mark` entries say when a point was placed by the form's move (`shift`).

**To measure on the next run:** the decision calls per dropdown (expected one or none), whether any dropdown is left to the model and which, the point checks skipped (the agent's terminal says how many the page answered), whether the plan runs past the upload in one piece, and whether the stop after the code request stands at once.

## 8. The run `2ad55733` (1.95.0) and what 1.95.1 does about it

Written 2026-10-21, after the run and before a new one. Nothing below was run in a real browser by Claude.

**What the run showed**: 162 s, 5 model calls (11 before), 12 decision calls (32 before), the stop after the code request accepted at once, the sponsorship box typed as a text box, and every single-choice dropdown picked from the options the page named. What still cost time, all of it on screen 2:

| Cause                                                                                                                                                                                                                                  | Time                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| The six "mark all that apply" dropdowns had no mark: their input is drawn without a size until something is typed. The model's points stayed on the questions, 20 px above the rows, and the probe clicks only gave the boxes focus.   | ~18 s typed fallback              |
| Typed into from the top down with each list left open, the click on the next dropdown landed on an option of the list above ("South Asian" was chosen by accident), and "Male" typed into a list of "Man, Woman, …" showed no options. | two more plans and surveys, ~44 s |
| The first model call took 25 s (the provider's wait), for a plan of the résumé upload alone.                                                                                                                                           | ~15 s over the usual              |

**What 1.95.1 does**: a text box or dropdown input drawn without a size gets the box of the row it sits on ([`control-marks-page.ts`](../../extension/src/agent/control-marks-page.ts)), so it is a mark, the point is moved onto the row, the label answers the check, and the probe's click opens the list; a typed probe closes its list after its picture ([`probe.go`](../../../acorn-agent/agent/probe.go)); a probe click that gave no control focus is made again 12 px lower before anything is typed; the trace's `bound` covers the whole plan; the note for a list that showed no options tells the model to choose again with the list's own wording.

**To measure on the next run:** `marks` in the step-2 trace entry (expected about 50 at the first look of the form, not 38), the six dropdowns picked in the pick batch with no typed stage, no accidental choice, and the whole form in three model calls.

## 9. The run `458f6b32` (1.97.0) and what 1.98.0 does about it

Written 2026-10-21, after the run and before a new one. Nothing below was run in a real browser by Claude.

**What the run showed** (Greenhouse, 204 s, 11 model calls, stopped by the person): the names and the email went in, the country was chosen from the options the page named with no picture, and then nine clicks on the phone box, one per step, gave nothing focus; each refused typing skipped the eighteen planned actions after it, and each step re-surveyed six screens. The phone input is wrapped by intl-tel-input together with its flag button, so the page reported no field round it (the field climb stopped at the first ancestor with two controls), the model's points at the middle of the drawn box fell outside the bare input, nothing bound them, and nothing moved them onto the input. The picture check passed every one of them, since by the picture the point is on the Phone box; only the page knew where the input was. A second run, on a multi-step form, stopped for one identity number with six required fields of the step empty, because the send's shortcut took the next page's fields for the applicant's part.

**What 1.98.0 does**: a field's box climbs past ancestors whose other controls are only buttons or links, and the hit test agrees ([`control-marks-page.ts`](../../extension/src/agent/control-marks-page.ts)); a point on no control is bound by the model's own label to the one control within a row that carries it, and aimed onto it ([`marks.go`](../../../acorn-agent/agent/marks.go)); typing refused for want of focus skips only what was meant for that control and the batch goes on ([`executor.ts`](../../extension/src/agent/executor.ts)); the model's next look says where the page reports the control the click named, from the point it gave ([`unreached.go`](../../../acorn-agent/agent/unreached.go)); the send's shortcut applies only while the page is still the page that was sent, and a stop is sent back naming the required fields the page still reports empty that the decision model judges the run's to fill, as long as each pass fills some of them ([`stopgate.go`](../../../acorn-agent/agent/stopgate.go)); a group of radio buttons reports itself empty and required as one question; and the prompt says a field that needs the applicant makes the step a working step for the others.

**To measure on the next run:** the phone filled in the first plan (`bound` in the step-2 trace entry names the phone click), no `agent-actions:skipped` entry of more than the typing and keys of one field, and on a multi-step form a stop that names the step's empty fields once and then stands with only the applicant's own left.
