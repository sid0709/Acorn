// Checks, with no model call, how the extension's page side reads and answers two
// required Yes / No questions that sit in ONE section of a form, each question's words
// in a plain <div> that ends with a required mark ("✱"), the way some job boards draw them:
// - each question is named by its words, never by the mark;
// - the two questions are two groups, each with its own identity;
// - a step answers the group the plan named, even when its index points into the other
//   question's options, and never answers the other question;
// - a step naming a group that is not on the page fails rather than guessing.
//
//   bun run build:acorn && bun tests/e2e/mock-apply/choices.ts
import puppeteer, { TargetType } from "puppeteer";

import { MSG, type DomNode } from "../../../acorn/extension/src/types";

import { EXTENSION_DIR } from "./config";
import { mockPort, startMockSite } from "./server";

import type { FormField } from "../../../acorn/packages/shared/form-fields";

const VIEWPORT = { width: 1280, height: 900 };
const FIRST = "Are you authorized to work in the United States?";
const SECOND =
  "Will you now or in the future require the company to file a petition for visa status?";

type Fetched = { tree: DomNode; formFields?: FormField[] };
type StepResult = { ok: boolean; error?: string; details?: { valueAfter?: string } };

const failures: string[] = [];
function check(passed: boolean, what: string, detail?: unknown) {
  console.log(
    `${passed ? "ok  " : "FAIL"} ${what}${passed || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`,
  );
  if (!passed) failures.push(what);
}

function findAll(node: DomNode, test: (node: DomNode) => boolean, out: DomNode[] = []): DomNode[] {
  if (test(node)) out.push(node);
  for (const child of node.children) findAll(child, test, out);
  return out;
}

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

  const page = await browser.newPage();
  await page.goto(`${siteUrl}/job`);
  await page.waitForFunction(() => document.body.dataset.step === "posting");
  /** The same two questions drawn two ways: options as siblings of the questions, and one box per question. */
  const option = (name: string, value: string) =>
    `<label><input type="radio" name="${name}" value="${value}"><span>${value}</span></label>`;
  const markups = {
    "options beside the questions": `
      <form id="visa"><h4>Visa Status</h4>
        <input type="hidden" name="cards[v][baseTemplate]" value="{}">
        <div>${FIRST}<span>✱</span></div>
        ${option("cards[v][field0]", "Yes")}${option("cards[v][field0]", "No")}
        <div>${SECOND}<span>✱</span></div>
        ${option("cards[v][field1]", "Yes")}${option("cards[v][field1]", "No")}
      </form>`,
    "one box per question": `
      <form id="visa"><h4>Visa Status</h4>
        <div class="q"><div>${FIRST}<span>✱</span></div><ul>
          <li>${option("cards[v][field0]", "Yes")}</li><li>${option("cards[v][field0]", "No")}</li></ul></div>
        <div class="q"><div>${SECOND}<span>✱</span></div><ul>
          <li>${option("cards[v][field1]", "Yes")}</li><li>${option("cards[v][field1]", "No")}</li></ul></div>
      </form>`,
  };
  const draw = (html: string) =>
    page.evaluate((markup) => {
      document.body.innerHTML = markup;
    }, html);
  const tabId = await control.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}/*` });
    return tab?.id ?? null;
  }, siteUrl);
  if (tabId == null) throw new Error("the site's tab was not found");

  const send = <T>(message: Record<string, unknown>): Promise<T> =>
    control.evaluate((id, msg) => chrome.tabs.sendMessage(id, msg, { frameId: 0 }), tabId, message);
  const read = () => send<Fetched>({ type: MSG.FETCH_DOM, formFields: true });
  const step = (patch: Record<string, unknown>) =>
    send<StepResult>({
      type: MSG.PLAN_STEP,
      step: {
        action: "select_radio",
        element_index: null,
        element_indexes: null,
        expected_label: null,
        expected_role: "radio",
        value: null,
        ms: null,
        ...patch,
      },
    });
  const chosen = () =>
    page.evaluate(() =>
      Object.fromEntries(
        ["field0", "field1"].map((name) => [
          name,
          document.querySelector(`input[name="cards[v][${name}]"]:checked`)?.value ?? null,
        ]),
      ),
    );

  for (const [name, html] of Object.entries(markups)) {
    console.log(`\n— ${name}`);
    await draw(html);
    // 1. Each question is named by its words, and is a group of its own.
    const dom = await read();
    const radios = (dom.formFields ?? []).filter((field) => field.kind === "radio");
    check(radios.length === 2, "the two questions are two fields", radios.length);
    check(
      radios[0]?.label.includes("authorized") && radios[1]?.label.includes("petition"),
      "each field is named by its question, not by the required mark",
      radios.map((field) => field.label),
    );
    check(
      Boolean(radios[0]?.group) && radios[0]?.group !== radios[1]?.group,
      "each field has its own group",
      radios.map((field) => field.group),
    );
    const inputOf = (name: string, value: string) =>
      findAll(
        dom.tree,
        (node) =>
          node.tag === "input" &&
          node.attrs?.name === `cards[v][${name}]` &&
          node.attrs?.value === value,
      )[0];
    const secondYes = inputOf("field1", "Yes");

    // 2. A step on the second question answers it.
    const answered = await step({
      element_index: secondYes?.nodeId,
      expected_label: radios[1]?.label,
      expected_group: radios[1]?.group,
      value: "No",
    });
    check(answered.ok, "a step on the second question succeeds", answered);
    check(
      (await chosen()).field1 === "No" && (await chosen()).field0 === null,
      "it answers the second question and leaves the first alone",
      await chosen(),
    );

    // 3. A step naming the first group, with an index into the second, answers the first.
    const moved = await step({
      element_index: secondYes?.nodeId,
      expected_label: radios[0]?.label,
      expected_group: radios[0]?.group,
      value: "Yes",
    });
    const after = await chosen();
    check(moved.ok, "a step naming the first group succeeds", moved);
    check(
      after.field0 === "Yes" && after.field1 === "No",
      "an index that points into the other question never answers it",
      after,
    );

    // 4. A step naming a group that is not on the page fails, and changes nothing.
    const gone = await step({
      element_index: secondYes?.nodeId,
      expected_label: "Another question",
      expected_group: "radio::nowhere",
      value: "Yes",
    });
    check(!gone.ok, "a step naming a group that is not on the page fails", gone);
    check((await chosen()).field1 === "No", "and the page is left as it was", await chosen());
  }

  // Text areas and a file field drawn the same way: the question in a plain <div> before a
  // control that has only a name. The name is how the page refers to it, never what it asks.
  console.log("\n— questions beside controls that have only a name");
  await draw(`
    <form id="extra"><h4>Additional Information</h4>
      <div>Desired Compensation Range<span>✱</span></div>
      <textarea name="cards[x][field9]"></textarea>
      <div>Please explain any gaps in your employment history<span>✱</span></div>
      <textarea name="cards[x][field10]"></textarea>
      <div>Please upload your completed Self-Assessment here.<span>✱</span></div>
      <a class="overlay"><span>Upload file</span></a>
      <input type="file" name="cards[x][field0]">
    </form>`);
  const extra = await read();
  const labels = (extra.formFields ?? []).map((field) => field.label);
  check(
    labels.length === 3 && !labels.some((label) => label.startsWith("cards[")),
    "no field is labelled by its internal name",
    labels,
  );
  check(
    labels[0]?.includes("Desired Compensation") && labels[1]?.includes("gaps in your employment"),
    "each text area is named by its question",
    labels,
  );
  check(labels[2]?.includes("Self-Assessment"), "the file field is named by its question", labels);
} finally {
  await browser.close();
  await site.stop(true);
}

if (failures.length) {
  console.error(`\nFAIL: ${failures.length} check${failures.length === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("\nPASS: a choice step answers the group the plan named and no other");
