import type { GlyphName } from "sid-ui";
import { DOWNLOADS } from "./apps";
import { BRAND } from "./config";

/**
 * Copy for the public home page. The FAQ also feeds the FAQPage structured data
 * in lib/seo.ts, so the answers Google shows match the ones on the page.
 */

export const SLOGAN_LEAD = "Two hands were never enough.";
export const SLOGAN_PAYOFF_LEAD = "Now you have";
export const SLOGAN_PAYOFF = `${SLOGAN_PAYOFF_LEAD} ${BRAND}.`;
export const SLOGAN = `${SLOGAN_LEAD} ${SLOGAN_PAYOFF}`;

/** The one-line category Acorn owns. */
export const POSITIONING = "The No. 1 auto-bid agent for job seekers";

export const HERO_LEDE = `${BRAND} is an AI agent in your browser that bids on jobs for you. It reads the posting, tailors an ATS-friendly resume, fills every field and screening question, and sends the application, so you apply to more jobs in a fraction of the time.`;

/** The one phrase for "start using Acorn". "Add to Chrome" is the secondary action beside it. */
export const CTA_START = "Start free";
export const CTA_INSTALL = "Add to Chrome";

/** In-page anchors the landing nav links to. */
export const LANDING_SECTIONS = {
  agent: "auto-bid-agent",
  features: "features",
  faq: "faq",
} as const;

export const LANDING_NAV = [
  { label: "Auto-bid", id: LANDING_SECTIONS.agent },
  { label: "Features", id: LANDING_SECTIONS.features },
  { label: "FAQ", id: LANDING_SECTIONS.faq },
] as const;

/** Application systems Acorn bids through. It reads the form on the page, not a per-site script. */
export const JOB_SITES = [
  "Greenhouse",
  "Lever",
  "Workday",
  "Ashby",
  "iCIMS",
  "SmartRecruiters",
  "Jobvite",
  "BambooHR",
  "Workable",
  "Company career pages",
] as const;

export type AgentStep = { id: string; title: string; description: string; icon: GlyphName };

/** What the auto-bid agent does with one posting, in order. */
export const AGENT_FLOW: AgentStep[] = [
  {
    id: "discover",
    title: "Discover",
    icon: "search",
    description: "Open a job board or a company career page. Acorn reads the job description.",
  },
  {
    id: "match",
    title: "Match",
    icon: "star",
    description: "The AI agent weighs the role against your profile, skills, and experience.",
  },
  {
    id: "tailor",
    title: "Tailor",
    icon: "file",
    description: "It writes an ATS-friendly resume for that posting and covers its keywords.",
  },
  {
    id: "fill",
    title: "Fill",
    icon: "edit",
    description:
      "Every field, dropdown, upload, and screening question is answered from your profile.",
  },
  {
    id: "bid",
    title: "Bid",
    icon: "send",
    description: "The application goes out in one click, and the agent moves to the next posting.",
  },
  {
    id: "track",
    title: "Track",
    icon: "mail",
    description: "Recruiter replies in Gmail are sorted into interviews, next steps, and offers.",
  },
];

export type LandingFeature = {
  title: string;
  icon: GlyphName;
  description: string;
  /** Wide tiles take two columns of the bento grid. */
  wide?: boolean;
};

export const FEATURES: LandingFeature[] = [
  {
    title: "Auto-bid on every posting",
    icon: "send",
    wide: true,
    description:
      "Acorn turns each job you open into a finished application. No copy and paste, no retyping your work history, no tab you forget to come back to.",
  },
  {
    title: "AI autofill for any form",
    icon: "sparkle",
    description:
      "Text fields, dropdowns, radio buttons, and file uploads on Greenhouse, Lever, Workday, and more.",
  },
  {
    title: "Screening questions, answered",
    icon: "chat",
    description:
      'Work authorization, salary expectations, and "Why us?" drafted from your experience and the posting.',
  },
  {
    title: "ATS-friendly resume per job",
    icon: "file",
    description:
      "A tailored resume for each job description, in a clean layout applicant tracking systems parse.",
  },
  {
    title: "Keyword match score",
    icon: "search",
    description: "See which keywords you cover and which you miss before you bid.",
  },
  {
    title: "Recruiter replies, sorted",
    icon: "mail",
    wide: true,
    description:
      "Connect Gmail and every reply lands in interviews, next steps, offers, or closed roles, so no recruiter waits on you.",
  },
  {
    title: "Job search analytics",
    icon: "calendar",
    description: "Bids, reply rate, and interviews week by week, so you know what works.",
  },
  {
    title: "One profile, every application",
    icon: "user",
    description: "Upload your resume once and Acorn builds the profile it fills from.",
  },
  {
    title: "Your AI model, your key",
    icon: "lock",
    description:
      "AI runs on the OpenRouter key in your profile. Pick the model and see what each call costs.",
  },
];

export type Faq = { question: string; answer: string };

const browserName = (name: string) => name.replace(`${BRAND} for `, "");
const availableBrowsers = DOWNLOADS.filter((target) => target.availability === "available")
  .map((target) => browserName(target.name))
  .join(" and ");
const comingBrowsers = DOWNLOADS.filter((target) => target.availability === "soon")
  .map((target) => browserName(target.name))
  .join(" and ");

export const FAQS: Faq[] = [
  {
    question: "What is Acorn?",
    answer: `${BRAND} is the No. 1 auto-bid agent for job seekers: an AI browser extension that applies to jobs for you. It tailors an ATS-friendly resume to each posting, fills the application, answers screening questions, and sorts recruiter replies in Gmail.`,
  },
  {
    question: "What does auto-bid mean for job applications?",
    answer:
      "Auto-bid means the agent prepares and sends an application for each job you choose, the way a bidder places bids automatically. Instead of spending twenty minutes on every form, you pick the role and Acorn does the typing.",
  },
  {
    question: "Is Acorn an AI agent?",
    answer:
      "Yes. Acorn reads the job description and the application form on the page, decides what each field needs, and fills it from your profile with an AI model you choose.",
  },
  {
    question: "Which job sites does Acorn work on?",
    answer: `Acorn reads the application form on the page instead of relying on a script per site, so it works on ${JOB_SITES.slice(0, -1).join(", ")}, and company career pages.`,
  },
  {
    question: "Does Acorn answer screening questions?",
    answer:
      'Yes. Work authorization, sponsorship, salary expectations, years of experience, and open-ended questions like "Why do you want to work here?" are drafted from your profile and the posting.',
  },
  {
    question: "What makes a resume ATS-friendly?",
    answer:
      "Applicant tracking systems read your resume before a person does. They favor standard section headings, a simple single-column layout, and the same words the job description uses. Acorn writes each draft that way and shows which of the posting's keywords you cover.",
  },
  {
    question: "Which AI model does Acorn use?",
    answer:
      "The one you pick. AI requests run on the OpenRouter key saved in your profile, and Acorn shows the cost of each call.",
  },
  {
    question: "Which browsers are supported?",
    answer: `${availableBrowsers}, plus Brave and Arc, which run Chrome extensions. ${comingBrowsers} are coming soon.`,
  },
  {
    question: "How does the extension sign in?",
    answer:
      "With your Acorn account. Sign in on this site in the same browser, open the Acorn side panel, and choose Continue.",
  },
];
