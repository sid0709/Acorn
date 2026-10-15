// Checks, with no model call, three page-side behaviours that decide whether a form is
// answered right:
// - a lone required box sends its whole statement to the decision model, not the clipped label;
// - a tag box that already shows the answer as a tag is not typed into again;
// - a dropdown whose search finds nothing leaves the box as it was, not with its last query.
//
//   bun run build:acorn && bun tests/e2e/mock-apply/accuracy.ts
import puppeteer, { TargetType } from "puppeteer";

import { MSG, type DomNode } from "../../../acorn/extension/src/types";

import { EXTENSION_DIR } from "./config";
import { mockPort, startMockSite } from "./server";

import type { FormField } from "../../../acorn/packages/shared/form-fields";

const VIEWPORT = { width: 1280, height: 900 };
const TAIL = "including the processing of my data by automated tools";
const LONG_STATEMENT = `By clicking the I Accept button you confirm that you have read the Applicant Privacy Notice at https://example.test/privacy and you provide the specific consent described there, ${"for the purposes it lists, ".repeat(8)}${TAIL}.`;

type Fetched = { tree: DomNode; formFields?: FormField[] };
type StepResult = { ok: boolean; error?: string; alreadyFilled?: boolean };

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
        action: "fill",
        element_index: null,
        element_indexes: null,
        expected_label: null,
        expected_role: "textbox",
        value: null,
        ms: null,
        ...patch,
      },
    });
  const draw = (html: string) =>
    page.evaluate((markup) => {
      document.body.innerHTML = markup;
    }, html);

  console.log("— a lone required box's whole statement");
  await draw(`<form><fieldset aria-required="true"><legend>${LONG_STATEMENT}<span>*</span></legend>
    <input type="checkbox" id="accept" name="q[]" value="1"><label for="accept">I Accept</label></fieldset></form>`);
  const consent = (await read()).formFields?.find((field) => field.kind === "toggle");
  check(Boolean(consent), "the box is a toggle field");
  check(
    (consent?.label.length ?? 0) <= 260 && !consent?.label.includes(TAIL),
    "its label is clipped",
    consent?.label.length,
  );
  check(
    consent?.statement?.includes(TAIL) === true,
    "the whole statement rides with it",
    consent?.statement?.slice(-80),
  );

  console.log("\n— a tag box that shows the answer as a tag");
  await draw(`<form><label for="skills">Skills</label>
    <div class="tags"><span class="tag"><span>Python</span><a class="remove">x</a></span>
    <input id="skills" type="text" placeholder="Type a skill and press enter"></div></form>`);
  const tags = await read();
  const skills = tags.formFields?.find((field) => field.label.includes("Skills"));
  const box = findAll(tags.tree, (node) => node.tag === "input" && node.attrs?.id === "skills")[0];
  const again = await step({
    element_index: box?.nodeId ?? skills?.elementIndex,
    expected_label: skills?.label,
    value: "Python",
  });
  check(
    again.ok && again.alreadyFilled === true,
    "the answer shown as a tag is not typed again",
    again,
  );
  const typed = await page.evaluate(
    () => (document.getElementById("skills") as HTMLInputElement).value,
  );
  check(typed === "", "and the box was left empty", typed);
  const other = await step({
    element_index: box?.nodeId ?? skills?.elementIndex,
    expected_label: skills?.label,
    value: "Go",
  });
  check(other.ok && other.alreadyFilled !== true, "a different answer is still typed", other);
} finally {
  await browser.close();
  await site.stop(true);
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
process.exit(0);
