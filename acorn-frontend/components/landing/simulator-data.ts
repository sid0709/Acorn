/** Sample content for the live agent window. It shows the product at work; it is nobody's account. */

export type SampleJob = { id: string; title: string; where: string; match: string };

export const SAMPLE_JOBS: SampleJob[] = [
  {
    id: "frontend",
    title: "Senior Frontend Engineer",
    where: "Northwind · Greenhouse",
    match: "Strong match",
  },
  {
    id: "payments",
    title: "Backend Engineer, Payments",
    where: "Contoso · Lever",
    match: "Strong match",
  },
  { id: "data", title: "Data Analyst", where: "Fabrikam · Workday", match: "Good match" },
];

export type SampleAnswer = { jobId: string; question: string; answer: string };

/** The screening answer the agent types for each sample job, in the same order. */
export const SAMPLE_ANSWERS: SampleAnswer[] = [
  {
    jobId: "frontend",
    question: "Why do you want to work at Northwind?",
    answer:
      "Your design-system team ships to millions of people, and that is the work I do best. At my last role I cut our bundle by 38% and moved every page to a shared component library. I would bring that to Northwind from week one.",
  },
  {
    jobId: "payments",
    question: "Describe a system you made more reliable.",
    answer:
      "I rebuilt our payout service around idempotent retries and a dead-letter queue, which ended duplicate transfers. The same approach fits Contoso's ledger, and I can start on it right away.",
  },
  {
    jobId: "data",
    question: "What tools do you use for analysis?",
    answer:
      "SQL and Python every day, with dashboards in the tools your team already uses. I turn a vague question into one metric, one chart, and a decision someone can act on.",
  },
];

export const SAMPLE_STEPS = [
  {
    title: "Job description read",
    detail: "The role, its requirements, and its keywords, taken from the page.",
  },
  {
    title: "Resume tailored",
    detail: "An ATS-friendly resume for this posting, attached to the form.",
  },
] as const;

/** Pause after a typed answer before the next job, in milliseconds. */
export const NEXT_JOB_DELAY_MS = 3200;
/** Time between typed characters, in milliseconds. */
export const TYPE_INTERVAL_MS = 25;
