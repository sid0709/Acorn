// Prepares the local Acorn test account the e2e run uses: a made-up applicant
// profile and a Library résumé. Credentials are generated and kept in the
// git-ignored .e2e-account.json. The account's OpenRouter key is never written by
// this script unless you pass your own in E2E_OPENROUTER_KEY.
import { randomBytes } from "node:crypto";

import { ACCOUNT_FILE, RESUME_FILE, api, readAccount, signIn, type E2EAccount } from "./config";

/** The made-up applicant the test applies as. */
const APPLICANT = {
  fullName: "Jordan Example",
  firstName: "Jordan",
  lastName: "Example",
  headline: "Senior Data Engineer",
  phone: "(555) 010-0199",
  street: "100 Example Street",
  city: "Austin",
  state: "Texas",
  zip: "78701",
  country: "United States",
  citizenship: "US Citizen",
  workAuthorized: "Yes",
  visaSponsorship: "No — no sponsorship needed",
  over18: "Yes",
  gender: "decline",
  veteranStatus: "I am not a protected veteran",
  disability: "decline",
  linkedin: "https://www.linkedin.com/in/jordan-example",
  desiredSalary: "150000",
  timeline: [
    {
      id: "job-1",
      kind: "role",
      title: "Senior Data Engineer",
      org: "Northwind Analytics",
      location: "Austin, TX",
      summary: "ELT pipelines in Python and SQL on Snowflake; dbt; Airflow.",
      startMonth: "03",
      startYear: "2021",
      endMonth: "",
      endYear: "",
      current: true,
    },
    {
      id: "edu-1",
      kind: "education",
      title: "B.S. Computer Science",
      org: "University of Texas at Austin",
      location: "Austin, TX",
      summary: "",
      startMonth: "08",
      startYear: "2013",
      endMonth: "05",
      endYear: "2017",
      current: false,
    },
  ],
};

const testSecret = () => `E2e.${randomBytes(9).toString("base64url")}!`;

async function account(): Promise<{ account: E2EAccount; token: string }> {
  const existing = await readAccount();
  if (existing) return { account: existing, token: await signIn(existing) };
  const made: E2EAccount = {
    name: APPLICANT.fullName,
    email: `e2e.${randomBytes(4).toString("hex")}@example.test`,
    password: testSecret(),
    sitePassword: testSecret(),
  };
  const res = await api<{ token: string }>("/acorn/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name: made.name, email: made.email, password: made.password }),
  });
  await Bun.write(ACCOUNT_FILE, JSON.stringify(made, null, 2));
  console.log(`Created local test account ${made.email} (credentials in ${ACCOUNT_FILE})`);
  return { account: made, token: res.token };
}

async function profile(made: E2EAccount, token: string): Promise<boolean> {
  const current = await api<{ profile: Record<string, unknown> & { openrouterApiKey?: string } }>(
    "/acorn/profile",
    { token },
  );
  const key = process.env.E2E_OPENROUTER_KEY?.trim() || (current.profile.openrouterApiKey ?? "");
  await api("/acorn/profile", {
    method: "PUT",
    token,
    body: JSON.stringify({
      ...current.profile,
      ...APPLICANT,
      email: made.email,
      defaultAccountPassword: made.sitePassword,
      openrouterApiKey: key,
    }),
  });
  return key !== "";
}

async function library(token: string): Promise<void> {
  const listed = await api<{ resumes?: { id?: string; resumeId?: string; analyzed?: boolean }[] }>(
    "/acorn/resume/library",
    { token },
  );
  let row = listed.resumes?.[0];
  if (!row) {
    const data = Buffer.from(await Bun.file(RESUME_FILE).arrayBuffer()).toString("base64");
    const made = await api<{ resume: { id?: string; resumeId?: string } }>(
      "/acorn/resume/library",
      {
        method: "POST",
        token,
        body: JSON.stringify({
          fileName: "sample-resume.docx",
          title: "Data Engineer",
          contentBase64: data,
        }),
      },
    );
    row = made.resume;
    console.log("Uploaded the sample résumé to the test Library");
  }
  const id = row.id ?? row.resumeId;
  if (!id) throw new Error("the Library row has no id");
  if (row.analyzed) return;
  await api(`/acorn/resume/library/${id}/analyze`, { method: "POST", token, body: "{}" });
  console.log("Analyzed the Library résumé");
}

const { account: made, token } = await account();
const hasKey = await profile(made, token);
if (!hasKey) {
  console.log(
    [
      "",
      "The test account has no OpenRouter key yet, and Run needs one for its decisions.",
      "Add your key to this local test account yourself, then run setup again:",
      "",
      "  E2E_OPENROUTER_KEY=<your key> bun tests/e2e/mock-apply/setup.ts",
      "",
    ].join("\n"),
  );
  process.exit(2);
}
await library(token);
console.log("Test account ready.");
