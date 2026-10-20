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
