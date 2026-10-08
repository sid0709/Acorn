/**
 * Search terms Acorn wants to rank for, grouped by intent. lib/seo.ts sends all of
 * them as meta keywords and JSON-LD; the landing "topics" section shows each group
 * as readable copy, so the words also appear in the page body.
 */

export type KeywordGroup = { id: string; title: string; description: string; terms: string[] };

export const KEYWORD_GROUPS: KeywordGroup[] = [
  {
    id: "auto-bid",
    title: "Auto-bid and auto-apply",
    description: "Send more applications without retyping a single form.",
    terms: [
      "auto bid jobs",
      "auto-bid for job seekers",
      "job auto bidder",
      "automatic job bidding",
      "auto apply to jobs",
      "auto apply bot",
      "automated job applications",
      "bulk job applications",
      "one-click apply",
      "mass apply to jobs",
      "apply to jobs automatically",
      "job bid automation",
      "bid on jobs faster",
      "LinkedIn Easy Apply alternative",
    ],
  },
  {
    id: "ai-agent",
    title: "AI job search agent",
    description: "An agent that reads postings and fills applications for you.",
    terms: [
      "AI job agent",
      "AI job application agent",
      "AI job search assistant",
      "AI auto apply",
      "AI job applier",
      "autonomous job search agent",
      "AI copilot for job seekers",
      "browser AI agent",
      "AI form filler",
      "GPT job application assistant",
      "AI answers screening questions",
      "AI recruiter reply sorting",
    ],
  },
  {
    id: "applications",
    title: "Job applications and autofill",
    description: "Every field, dropdown, upload, and screening question.",
    terms: [
      "job application autofill",
      "autofill job applications",
      "job application Chrome extension",
      "job application filler",
      "Greenhouse autofill",
      "Lever autofill",
      "Workday autofill",
      "Ashby autofill",
      "iCIMS autofill",
      "SmartRecruiters autofill",
      "career page application",
      "fill job forms fast",
    ],
  },
  {
    id: "resume",
    title: "ATS resume and keywords",
    description: "A resume written for each job description.",
    terms: [
      "ATS resume",
      "ATS-friendly resume builder",
      "ATS resume checker",
      "resume keyword match",
      "resume keyword scanner",
      "tailored resume generator",
      "AI resume builder",
      "resume optimizer",
      "job description keyword match",
      "beat applicant tracking systems",
    ],
  },
  {
    id: "productivity",
    title: "Job search productivity",
    description: "Track every bid and every reply in one place.",
    terms: [
      "job search productivity",
      "job application tracker",
      "job search tracker",
      "job hunt organizer",
      "recruiter email tracker",
      "Gmail job application tracker",
      "interview tracker",
      "job search analytics",
      "apply to more jobs in less time",
      "save time job hunting",
      "remote job search tool",
      "get hired faster",
    ],
  },
];

export const ALL_KEYWORDS = KEYWORD_GROUPS.flatMap((group) => group.terms);
