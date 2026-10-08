// A local stand-in for a long, multi-step job application, built to reproduce the
// behaviours real application platforms have that Acorn's Run must handle:
// - the page draws itself a moment after it loads;
// - a "how do you want to apply" dialog over the posting;
// - a sign-in step (sign-in method chooser, sign-in, create account, forgot
//   password), with a transparent click-catching layer over the send buttons and
//   a hidden field meant only for robots;
// - text fields whose value counts only once the field is left (focusout);
// - a search box (enterkeyhint="search") whose results must be picked;
// - required checks that run on "Save and Continue", with an error summary;
// - a final Review step whose Submit sends the application.
// Every step's name is on <body data-step>, so the test can screenshot each one.

const RENDER_DELAY_MS = 600;
const ACCOUNTS_KEY = "mockApplyAccounts";
const SESSION_KEY = "mockApplySession";
const ANSWERS_KEY = "mockApplyAnswers";

const STEPS = [
  { key: "account", title: "Create Account/Sign In" },
  { key: "info", title: "My Information" },
  { key: "experience", title: "My Experience" },
  { key: "questions", title: "Application Questions" },
  { key: "disclosures", title: "Voluntary Disclosures" },
  { key: "review", title: "Review" },
];

const SOURCES = {
  Campus: ["Career Fair", "University Partnership"],
  "Company Website": ["Careers Site"],
  "Job Board": ["Indeed", "Glassdoor", "LinkedIn", "ZipRecruiter"],
  Referral: ["Employee Referral"],
  "Social Network": ["LinkedIn", "Facebook", "X"],
};
const PHONE_CODES = {
  "North America": ["United States of America (+1)", "Canada (+1)"],
  Europe: ["United Kingdom (+44)", "Germany (+49)"],
};
const STATES = ["Texas", "California", "New York", "Florida", "Washington", "Illinois"];

const app = document.getElementById("app");
const store = {
  get: (key, fallback) => JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)),
  set: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
};

function setStep(step) {
  document.body.dataset.step = step;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "on")
      for (const [event, fn] of Object.entries(value)) node.addEventListener(event, fn);
    else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) node.append(child instanceof Node ? child : String(child));
  return node;
}

/** Draw a view a moment after the request, like an app rendering itself. */
function render(step, build) {
  app.replaceChildren();
  setStep("loading");
  setTimeout(() => {
    app.replaceChildren(build());
    setStep(step);
  }, RENDER_DELAY_MS);
}

/** A button that only reacts through a transparent layer on top of it. */
function caughtButton(text, onPress) {
  const wrap = el("span", { class: "btn-wrap" }, el("button", { type: "button" }, text));
  wrap.append(
    el("span", { class: "catcher", "aria-label": text, role: "button", on: { click: onPress } }),
  );
  return wrap;
}

function progress(current) {
  return el(
    "div",
    { class: "steps" },
    STEPS.map((step, i) =>
      el("span", { class: step.key === current ? "current" : "" }, `${i + 1}. ${step.title}`),
    ),
  );
}

// ---------------------------------------------------------------- posting

function postingView() {
  return el(
    "section",
    {},
    el("h1", {}, "Senior Data Engineer (Remote)"),
    el("p", {}, "Location: Remote, United States · Full time"),
    el("button", { type: "button", on: { click: openStartDialog } }, "Apply"),
    el("h2", {}, "About the role"),
    el(
      "p",
      {},
      "We are looking for a Senior Data Engineer to design, build, and operate batch and streaming data pipelines on a modern cloud data platform.",
    ),
    el("h2", {}, "Responsibilities"),
    el(
      "ul",
      {},
      el(
        "li",
        {},
        "Build and maintain ELT pipelines in Python and SQL on Snowflake and Databricks.",
      ),
      el("li", {}, "Model data with dbt and orchestrate workflows with Airflow."),
      el("li", {}, "Own data quality, monitoring, and cost of the platform on AWS."),
    ),
    el("h2", {}, "Requirements"),
    el(
      "ul",
      {},
      el("li", {}, "6+ years of data engineering experience."),
      el(
        "li",
        {},
        "Strong SQL and Python; experience with Spark, Kafka, and cloud data warehouses.",
      ),
      el("li", {}, "Experience with infrastructure as code and CI/CD."),
    ),
  );
}

function openStartDialog() {
  const backdrop = el("div", { class: "backdrop" });
  const dialog = el(
    "div",
    { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "start-title" },
    el("h2", { id: "start-title" }, "Start Your Application"),
    el(
      "button",
      { type: "button", on: { click: () => (location.href = "/apply?mode=resume") } },
      "Autofill with Resume",
    ),
    el(
      "button",
      { type: "button", on: { click: () => (location.href = "/apply?mode=manual") } },
      "Apply Manually",
    ),
    el(
      "button",
      { type: "button", on: { click: () => (location.href = "/apply?mode=last") } },
      "Use My Last Application",
    ),
    el(
      "button",
      { type: "button", on: { click: () => (location.href = "/other-service") } },
      "Apply with ExampleConnect",
    ),
  );
  document.body.append(backdrop, dialog);
}

// ---------------------------------------------------------------- account

function accountShell(...body) {
  return el(
    "section",
    {},
    el("h1", {}, "Senior Data Engineer (Remote)"),
    progress("account"),
    ...body,
  );
}

function chooserView() {
  return accountShell(
    el("h2", {}, "Sign In"),
    el(
      "button",
      { type: "button", on: { click: () => (location.href = "/other-service") } },
      "Sign in with Google",
    ),
    el(
      "button",
      { type: "button", on: { click: () => (location.href = "/other-service") } },
      "Sign in with LinkedIn",
    ),
    el("p", {}, "OR"),
    el(
      "button",
      { type: "button", on: { click: () => render("account-sign-in", signInView) } },
      "Sign in with email",
    ),
  );
}

function trapField() {
  return el(
    "div",
    { class: "trap" },
    el(
      "label",
      { for: "website" },
      "Enter website. This input is for robots only, do not enter if you're human.",
    ),
    el("input", { id: "website", type: "text", tabindex: "-1", autocomplete: "off" }),
  );
}

function signInView() {
  const banner = el("div");
  const email = el("input", {
    id: "signin-email",
    type: "email",
    autocomplete: "email",
    "aria-required": "true",
  });
  const password = el("input", {
    id: "signin-password",
    type: "password",
    "aria-required": "true",
  });
  const send = () => {
    if (document.getElementById("website").value) return; // a robot filled the trap
    const accounts = store.get(ACCOUNTS_KEY, {});
    if (accounts[email.value.trim().toLowerCase()] === password.value && password.value) {
      store.set(SESSION_KEY, email.value.trim().toLowerCase());
      render("info", infoView);
      return;
    }
    banner.replaceChildren(
      el(
        "div",
        { class: "banner", role: "alert" },
        "You may have entered the wrong email address or password or your account might be locked.",
      ),
    );
  };
  return accountShell(
    el("h2", {}, "Sign In"),
    banner,
    el("label", { for: "signin-email" }, "Email Address*"),
    email,
    el("label", { for: "signin-password" }, "Password*"),
    password,
    trapField(),
    caughtButton("Sign In", send),
    el(
      "p",
      {},
      "Don't have an account yet? ",
      el(
        "a",
        {
          href: "#",
          on: { click: (e) => (e.preventDefault(), render("account-create", createView)) },
        },
        "Create Account",
      ),
    ),
    el(
      "p",
      {},
      el(
        "a",
        {
          href: "#",
          on: { click: (e) => (e.preventDefault(), render("account-forgot", forgotView)) },
        },
        "Forgot your password?",
      ),
    ),
  );
}

function createView() {
  const banner = el("div");
  const email = el("input", {
    id: "create-email",
    type: "email",
    autocomplete: "email",
    "aria-required": "true",
  });
  const password = el("input", {
    id: "create-password",
    type: "password",
    "aria-required": "true",
  });
  const verify = el("input", { id: "create-verify", type: "password", "aria-required": "true" });
  const agree = el("input", { id: "create-agree", type: "checkbox", "aria-required": "true" });
  const send = () => {
    const key = email.value.trim().toLowerCase();
    const problems = [];
    if (!key) problems.push("Email Address is required.");
    if (password.value.length < 8) problems.push("Password must be at least 8 characters.");
    if (password.value !== verify.value) problems.push("The passwords do not match.");
    if (!agree.checked) problems.push("You must agree to the terms.");
    const accounts = store.get(ACCOUNTS_KEY, {});
    if (accounts[key]) problems.push("An account with this email address already exists.");
    if (problems.length) {
      banner.replaceChildren(el("div", { class: "banner", role: "alert" }, problems.join(" ")));
      return;
    }
    accounts[key] = password.value;
    store.set(ACCOUNTS_KEY, accounts);
    // Like many platforms: the new account goes back to the sign-in chooser.
    render("account", chooserView);
  };
  return accountShell(
    el("h2", {}, "Create Account"),
    banner,
    el("label", { for: "create-email" }, "Email Address*"),
    email,
    el("label", { for: "create-password" }, "Password*"),
    password,
    el("label", { for: "create-verify" }, "Verify New Password*"),
    verify,
    el("label", { for: "create-agree" }, agree, " I agree to the Terms and Conditions*"),
    caughtButton("Create Account", send),
    el(
      "p",
      {},
      "Already have an account? ",
      el(
        "a",
        {
          href: "#",
          on: { click: (e) => (e.preventDefault(), render("account-sign-in", signInView)) },
        },
        "Sign In",
      ),
    ),
  );
}

function forgotView() {
  const note = el("div");
  const email = el("input", { id: "forgot-email", type: "email", "aria-required": "true" });
  return accountShell(
    el("h2", {}, "Forgot Password"),
    el(
      "p",
      {},
      "You will receive an email with instructions to reset your password if an account exists for this email address.",
    ),
    note,
    el("label", { for: "forgot-email" }, "Email Address*"),
    email,
    caughtButton("Reset Password", () =>
      note.replaceChildren(el("div", { class: "note" }, "Check your email for a reset link.")),
    ),
  );
}

// ---------------------------------------------------------------- form steps

const answers = store.get(ANSWERS_KEY, {});
const saveAnswers = () => store.set(ANSWERS_KEY, answers);

/** A text field whose value counts only once the field is left, as on many platforms. */
function textField(id, label, { required = true, type = "text", multiline = false } = {}) {
  const input = multiline
    ? el("textarea", { id, "aria-required": required ? "true" : "false" })
    : el("input", { id, type, "aria-required": required ? "true" : "false" });
  input.value = answers[id] ?? "";
  input.addEventListener("focusout", () => {
    answers[id] = input.value.trim();
    saveAnswers();
  });
  return {
    id,
    label,
    required,
    node: el(
      "div",
      {},
      el("label", { for: id }, `${label}${required ? "*" : ""}`),
      input,
      errorLine(id),
    ),
  };
}

function selectField(id, label, options, { required = true } = {}) {
  const select = el(
    "select",
    {
      id,
      "aria-required": required ? "true" : "false",
      on: { change: () => ((answers[id] = select.value), saveAnswers()) },
    },
    el("option", { value: "" }, "Select One"),
    options.map((option) => el("option", { value: option }, option)),
  );
  select.value = answers[id] ?? "";
  return {
    id,
    label,
    required,
    node: el(
      "div",
      {},
      el("label", { for: id }, `${label}${required ? "*" : ""}`),
      select,
      errorLine(id),
    ),
  };
}

function radioField(id, label, options, { required = true } = {}) {
  const group = el(
    "fieldset",
    { id, "aria-required": required ? "true" : "false" },
    el("legend", {}, `${label}${required ? "*" : ""}`),
  );
  for (const option of options) {
    const radio = el("input", {
      type: "radio",
      name: id,
      value: option,
      id: `${id}-${option}`,
      on: { change: () => ((answers[id] = option), saveAnswers()) },
    });
    radio.checked = answers[id] === option;
    group.append(el("label", { for: `${id}-${option}` }, radio, ` ${option}`));
  }
  return { id, label, required, node: el("div", {}, group, errorLine(id)) };
}

function checkboxField(id, label) {
  const box = el("input", {
    type: "checkbox",
    id,
    "aria-required": "true",
    on: { change: () => ((answers[id] = box.checked ? "yes" : ""), saveAnswers()) },
  });
  box.checked = answers[id] === "yes";
  return {
    id,
    label,
    required: true,
    node: el("div", {}, el("label", { for: id }, box, ` ${label}*`), errorLine(id)),
  };
}

function fileField(id, label) {
  const input = el("input", {
    type: "file",
    id,
    "aria-required": "true",
    accept: ".pdf,.doc,.docx",
    on: { change: () => ((answers[id] = input.files?.[0]?.name ?? ""), saveAnswers()) },
  });
  const shown = el("div", {}, answers[id] ? `Uploaded: ${answers[id]}` : "");
  input.addEventListener("change", () =>
    shown.replaceChildren(answers[id] ? `Uploaded: ${answers[id]}` : ""),
  );
  return {
    id,
    label,
    required: true,
    node: el("div", {}, el("label", { for: id }, `${label}*`), input, shown, errorLine(id)),
  };
}

/** A search box: Enter shows matching options; picking one adds it. */
/**
 * A search box over a menu of categories, as on large application platforms:
 * opening it shows categories whose options open a deeper level (">"); searching
 * (type, then Enter) shows the matching answers themselves. Picked answers are
 * listed inside the field as options of a "items selected" list; the box empties.
 */
function searchPickField(id, label, tree) {
  const picked = answers[id] ? answers[id].split("|") : [];
  const chosen = el("ul", { role: "listbox", "aria-label": "items selected" });
  const info = el("div", { id: `${id}-info`, "aria-hidden": "true" });
  const popup = el("div", { class: "popup" });
  const input = el("input", {
    id,
    enterkeyhint: "search",
    autocomplete: "off",
    placeholder: "Search",
    "aria-required": "true",
    "aria-describedby": `${id}-info`,
  });
  const draw = () => {
    chosen.replaceChildren(...picked.map((p) => el("li", { role: "option", class: "pill" }, p)));
    info.textContent = `${picked.length} items selected`;
    answers[id] = picked.join("|");
    saveAnswers();
  };
  const pick = (answer) => {
    picked.push(answer);
    input.value = "";
    popup.replaceChildren();
    draw();
  };
  // Like real platforms, each option row reacts only on its inner row (a radio and
  // its label), not on the option element around it.
  const menu = (rows) =>
    popup.replaceChildren(
      el(
        "div",
        { role: "listbox", "aria-label": label },
        rows.map(([text, onPick]) =>
          el(
            "div",
            { role: "option", tabindex: "-1" },
            el(
              "div",
              { class: "row", on: { click: onPick } },
              el("input", { type: "radio", tabindex: "-1" }),
              el("span", {}, text),
            ),
          ),
        ),
      ),
    );
  // A category opens its answers under a back row, worded "Category: Answer".
  const categories = () =>
    menu(
      Object.keys(tree).map((category) => [
        category,
        () => {
          menu(tree[category].map((answer) => [`${category}: ${answer}`, () => pick(answer)]));
          popup.prepend(
            el("button", { type: "button", on: { click: categories } }, `← ${category}`),
          );
        },
      ]),
    );
  input.addEventListener("click", categories);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const query = input.value.trim().toLowerCase();
    // Results are worded "Category: Answer"; the same answer can sit in several categories.
    const found = Object.entries(tree).flatMap(([category, list]) =>
      list
        .filter((a) => a.toLowerCase().includes(query))
        .map((a) => [`${category}: ${a}`, () => pick(a)]),
    );
    menu(found);
  });
  draw();
  return {
    id,
    label,
    required: true,
    node: el(
      "div",
      {},
      el("label", { for: id }, `${label}*`),
      el("div", { class: "field" }, input, info, chosen),
      popup,
      errorLine(id),
    ),
  };
}

function errorLine(id) {
  return el("p", { id: `${id}-error`, class: "err" });
}

/** A form step: required checks on Save and Continue, with an error summary on top. */
function formStep(stepKey, heading, fields, next) {
  const summary = el("div");
  const check = () => {
    const missing = fields.filter((f) => f.required && !answers[f.id]);
    for (const field of fields) {
      const line = document.getElementById(`${field.id}-error`);
      const control = document.getElementById(field.id);
      const bad = missing.includes(field);
      line.textContent = bad
        ? `Error: The field ${field.label} is required and must have a value.`
        : "";
      control?.setAttribute("aria-invalid", bad ? "true" : "false");
    }
    summary.replaceChildren(
      missing.length
        ? el(
            "div",
            { class: "summary", role: "alert" },
            el("strong", {}, "Errors Found"),
            el(
              "ol",
              {},
              missing.map((f) =>
                el(
                  "li",
                  {},
                  `Error - ${f.label}: The field ${f.label} is required and must have a value.`,
                ),
              ),
            ),
          )
        : "",
    );
    if (!missing.length) next();
  };
  return el(
    "section",
    {},
    el("h1", {}, "Senior Data Engineer (Remote)"),
    progress(stepKey),
    el("h2", {}, heading),
    summary,
    fields.map((f) => f.node),
    caughtButton("Save and Continue", check),
  );
}

function infoView() {
  return formStep(
    "info",
    "My Information",
    [
      searchPickField("source", "How Did You Hear About Us?", SOURCES),
      radioField("previousWorker", "Have you previously worked for Example Corp?", ["Yes", "No"]),
      searchPickField("phoneCode", "Country Phone Code", PHONE_CODES),
      selectField("country", "Country", ["United States of America", "Canada", "United Kingdom"]),
      textField("firstName", "First Name"),
      textField("lastName", "Last Name"),
      textField("address1", "Address Line 1"),
      textField("city", "City"),
      selectField("state", "State", STATES),
      textField("postalCode", "Postal Code"),
      selectField("phoneType", "Phone Device Type", ["Mobile", "Home", "Work"]),
      textField("phone", "Phone Number", { type: "tel" }),
    ],
    () => render("experience", experienceView),
  );
}

function experienceView() {
  return formStep(
    "experience",
    "My Experience",
    [
      fileField("resume", "Resume/CV"),
      textField("jobTitle", "Most Recent Job Title"),
      textField("company", "Most Recent Company"),
      textField("linkedin", "LinkedIn Profile URL", { required: false }),
    ],
    () => render("questions", questionsView),
  );
}

function questionsView() {
  return formStep(
    "questions",
    "Application Questions",
    [
      radioField("authorized", "Are you legally authorized to work in the United States?", [
        "Yes",
        "No",
      ]),
      selectField("sponsorship", "Will you now or in the future require visa sponsorship?", [
        "Yes",
        "No",
      ]),
      selectField("sqlYears", "How many years of experience do you have with SQL?", [
        "0-2 years",
        "3-5 years",
        "6-9 years",
        "10+ years",
      ]),
      textField("why", "Why are you interested in this role?", { multiline: true }),
    ],
    () => render("disclosures", disclosuresView),
  );
}

function disclosuresView() {
  return formStep(
    "disclosures",
    "Voluntary Disclosures",
    [
      selectField("gender", "Gender", ["Male", "Female", "I do not wish to answer"]),
      selectField("veteran", "Veteran Status", [
        "I am not a protected veteran",
        "I identify as a protected veteran",
        "I do not wish to answer",
      ]),
      checkboxField("terms", "I have read and agree to the Terms and Conditions"),
    ],
    () => render("review", reviewView),
  );
}

function reviewView() {
  const rows = Object.entries(answers)
    .filter(([, v]) => v)
    .map(([k, v]) => el("li", {}, `${k}: ${v}`));
  return el(
    "section",
    {},
    el("h1", {}, "Senior Data Engineer (Remote)"),
    progress("review"),
    el("h2", {}, "Review"),
    el("p", {}, "Review your application, then submit it."),
    el("ul", {}, rows),
    caughtButton("Submit", () =>
      render("submitted", () =>
        el(
          "section",
          {},
          el("h1", {}, "Thank you!"),
          el("p", {}, "Your application was submitted."),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- routes

if (location.pathname.startsWith("/apply")) {
  if (store.get(SESSION_KEY, "")) render("info", infoView);
  else render("account", chooserView);
} else if (location.pathname.startsWith("/other-service")) {
  render("other-service", () =>
    el(
      "section",
      {},
      el("h1", {}, "Another service"),
      el("p", {}, "Signing in through another service is not part of this test."),
    ),
  );
} else {
  render("posting", postingView);
}
