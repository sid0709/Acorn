// Checks, with no model call, what the extension's page side makes of entry lists
// (education, work history) on the local application site's My Experience step:
// - buttons that act on the form (an entry's edit and delete, a form's cancel and
//   save, an add button) are never offered to the planner as answers, and plain
//   Yes / No buttons drawn alike are;
// - a pressed plain option that redraws itself still counts as an answer, and a
//   button that removes what it belongs to is caught as acting on the form, after
//   which buttons drawn like it are never pressed as answers;
// - a click that opens an entry form is read as one scope: its own fields (dates
//   named with their group), its own cancel and save, and it reads as still open
//   with what it needs once a save is refused, and as taken once saved.
//
//   bun run build:acorn && bun tests/e2e/mock-apply/entries.ts
import puppeteer, { TargetType } from "puppeteer";

import {
  MSG,
  type DomNode,
  type OpenScope,
  type ScopeState,
} from "../../../acorn/extension/src/types";

import { EXTENSION_DIR } from "./config";
import { mockPort, startMockSite } from "./server";

import type { FormField } from "../../../acorn/packages/shared/form-fields";

const VIEWPORT = { width: 1280, height: 900 };
/** How long the page gets to draw after a click before it is read. */
const DRAW_MS = 800;

type Fetched = { tree: DomNode; formFields?: FormField[]; scope?: OpenScope | null };
type StepResult = { ok: boolean; error?: string; details?: { valueAfter?: string } };

const failures: string[] = [];
function check(passed: boolean, what: string, detail?: unknown) {
  console.log(
    `${passed ? "ok  " : "FAIL"} ${what}${passed || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`,
  );
  if (!passed) failures.push(what);
}

function textOf(node: DomNode): string {
  return [node.text ?? "", ...node.children.map(textOf)].join(" ").replace(/\s+/g, " ").trim();
}

function findAll(node: DomNode, test: (node: DomNode) => boolean, out: DomNode[] = []): DomNode[] {
  if (test(node)) out.push(node);
  for (const child of node.children) findAll(child, test, out);
  return out;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const site = startMockSite();
const siteUrl = `http://127.0.0.1:${mockPort()}`;
const browser = await puppeteer.launch({
  headless: true,
  args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  defaultViewport: VIEWPORT,
});

try {
  const worker = await browser.waitForTarget(
    (t) => t.type() === TargetType.SERVICE_WORKER && t.url().startsWith("chrome-extension://"),
  );
  const extensionId = new URL(worker.url()).host;
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/sidebar.html`);

  // The My Experience step, drawn straight away.
  const page = await browser.newPage();
  await page.goto(`${siteUrl}/job`);
  await page.waitForFunction(() => document.body.dataset.step === "posting");
  await page.evaluate(() => {
    const view = window as unknown as {
      render: (step: string, build: unknown) => void;
      experienceView: unknown;
    };
    view.render("experience", view.experienceView);
  });
  await page.waitForFunction(() => document.body.dataset.step === "experience");
  const tabId = await control.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}/*` });
    return tab?.id ?? null;
  }, siteUrl);
  if (tabId == null) throw new Error("the site's tab was not found");

  const send = <T>(message: Record<string, unknown>): Promise<T> =>
    control.evaluate((id, msg) => chrome.tabs.sendMessage(id, msg, { frameId: 0 }), tabId, message);
  const read = (opts: Record<string, boolean> = {}) =>
    send<Fetched>({ type: MSG.FETCH_DOM, formFields: true, ...opts });
  const step = (patch: Record<string, unknown>) =>
    send<StepResult>({
      type: MSG.PLAN_STEP,
      step: {
        action: "select_radio",
        element_index: null,
        element_indexes: null,
        expected_label: null,
        expected_role: null,
        value: null,
        ms: null,
        ...patch,
      },
    });
  const buttonNamed = (tree: DomNode, name: string, nth = 0) =>
    findAll(
      tree,
      (node) =>
        node.tag === "button" && (textOf(node) === name || node.attrs?.["aria-label"] === name),
    )[nth];

  // 1. What the planner is offered.
  let dom = await read();
  const fields = dom.formFields ?? [];
  const buttonFields = fields.filter((field) => field.kind === "buttons");
  check(
    buttonFields.length === 1 && buttonFields[0].label.includes("relocate"),
    "only the plain Yes / No question is offered as buttons",
    buttonFields.map((field) => [field.label, field.options]),
  );
  check(
    !fields.some((field) =>
      (field.options ?? []).some((option) => /edit|delete|cancel|add /i.test(option)),
    ),
    "no edit, delete, cancel, or add button is offered as an answer",
  );

  // 2. A plain option that redraws itself is an answer.
  const no = buttonNamed(dom.tree, "No");
  const answered = await step({
    element_index: no?.nodeId,
    expected_label: "Are you willing to relocate for this role?",
    expected_role: "buttons",
    value: "No",
  });
  check(answered.ok, "pressing a plain option that redraws itself answers", answered);
  check(
    await page.evaluate(() => document.querySelector(".choice--on")?.textContent === "No"),
    "the page shows that answer",
  );

  // 3. An opening click is one scope: its fields and its own controls.
  await send({ type: MSG.SCOPE_CENSUS });
  await page.click(".entry-section .btn--add");
  await pause(DRAW_MS);
  dom = await read({ scope: true, scopeFields: true });
  const scope = dom.scope;
  const scopeTexts = (scope?.controlIds ?? []).map((id) => {
    const node = findAll(dom.tree, (n) => n.nodeId === id)[0];
    return node ? textOf(node) || node.attrs?.["aria-label"] : "";
  });
  check(scope != null && scope.fields > 0, "the add button opened a scope with fields", scope);
  check(
    scopeTexts.length === 2 &&
      scopeTexts.includes("Cancel") &&
      scopeTexts.includes("Add Education"),
    "the scope's own controls are its cancel and save, never its options",
    scopeTexts,
  );
  const scoped = (dom.formFields ?? []).map((field) => field.label);
  check(
    scoped.some((label) => label === "Start Date — Month") &&
      scoped.some((label) => label === "End Date — Year"),
    "a date's parts are named with their group",
    scoped,
  );
  check(
    scoped.includes("Degree") && !scoped.some((label) => /relocate|resume|linkedin/i.test(label)),
    "a scoped read lists the scope's fields only",
    scoped,
  );
  check(
    (dom.formFields ?? []).filter((field) => field.kind === "textarea").length === 1,
    "a text box's hidden twin is no field",
  );

  // 4. A refused save keeps the scope open, saying what it needs.
  await page.click(".entry-form .btn--save");
  await pause(DRAW_MS);
  let state = (await send<{ ok: boolean; state: ScopeState }>({ type: MSG.SCOPE_STATE })).state;
  check(
    state.open && state.issues.length > 0,
    "a refused save leaves the scope open with what it needs",
    state,
  );

  // 5. Filled and saved, the scope reads as taken.
  await page.click(".entry-form .pill-option:nth-child(1)");
  await page.evaluate(() => {
    const pick = (selector: string, value: string) => {
      const field = document.querySelector<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >(selector);
      if (!field) return;
      field.value = value;
      field.dispatchEvent(
        new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
      );
    };
    document.querySelector<HTMLButtonElement>(".entry-form .pill-option")?.click();
    pick("#education-entry-school", "University of Texas at Austin");
    pick("#education-entry-start-month", "08");
    pick("#education-entry-start-year", "2013");
  });
  await page.click(".entry-form .btn--save");
  await pause(DRAW_MS);
  state = (await send<{ ok: boolean; state: ScopeState }>({ type: MSG.SCOPE_STATE })).state;
  check(!state.open, "a saved scope reads as taken", state);
  await send({ type: MSG.SCOPE_END, committed: true });
  check(
    await page.evaluate(() => {
      const answers = JSON.parse(localStorage.getItem("mockApplyAnswers") || "{}") as Record<
        string,
        string
      >;
      return answers.education === "yes";
    }),
    "the page holds the education entry",
  );

  // 6. A button that removes what it belongs to acts on the form, and is caught.
  dom = await read();
  const remove = buttonNamed(dom.tree, "Delete", 1);
  const removed = await step({
    element_index: remove?.nodeId,
    expected_label: "Work Experience",
    expected_role: "buttons",
    value: "Delete",
  });
  check(
    !removed.ok && /acts on the form/.test(removed.error ?? ""),
    "a delete pressed as an answer is caught",
    removed,
  );
  dom = await read();
  const again = buttonNamed(dom.tree, "Delete");
  const refused = await step({
    element_index: again?.nodeId,
    expected_label: "Education",
    expected_role: "buttons",
    value: "Delete",
  });
  const deleted = await page.evaluate(() => Number(document.body.dataset.deleted || 0));
  check(!refused.ok && deleted === 1, "buttons drawn like it are never pressed as answers again", {
    refused,
    deleted,
  });
} finally {
  await browser.close();
  await site.stop(true);
}

if (failures.length) {
  console.error(`\nFAIL: ${failures.length} check${failures.length === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("\nPASS: entry lists and button roles read as a person reads them");
