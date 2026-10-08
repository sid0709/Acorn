import type { AcornAccount } from "@/lib/auth/session";

export const AGE_MAX = 3;
export const SALARY_MAX = 12;
export const PATH_MAX = 180;
export const SECRET_MAX = 200;
export const LINK_MAX = 200;
export const ADDRESS_MAX = 120;
export const ROLE_SUMMARY_ROWS = 6;
export const MONTHS_PER_YEAR = 12;
/** How far back the year pickers reach. */
export const YEAR_SPAN = 50;

export type EntryKind = "role" | "education";

export type CareerEntry = {
  id: string;
  kind: EntryKind;
  /** Job title, or the degree and field for education. */
  title: string;
  /** Employer, or school. */
  org: string;
  /** Where the role or school was, as written. */
  location: string;
  summary: string;
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
  current: boolean;
};

/** What Acorn types into an application. */
export type ApplicantProfile = {
  fullName: string;
  firstName: string;
  middleName: string;
  lastName: string;
  /** The professional title under the name, e.g. "Senior Automation Engineer". */
  headline: string;
  age: string;
  gender: string;
  pronouns: string;
  orientation: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  citizenship: string;
  country: string;
  zip: string;
  linkedin: string;
  github: string;
  portfolio: string;
  hispanicLatino: string;
  raceEthnicity: string;
  visaSponsorship: string;
  /** Legally authorized to work in the country of the job. */
  workAuthorized: string;
  publicTrust: string;
  securityClearance: string;
  over18: string;
  backgroundCheck: string;
  willingToRelocate: string;
  workModePreference: string;
  willingToTravel: string;
  noticePeriod: string;
  disability: string;
  veteranStatus: string;
  desiredSalary: string;
  openrouterApiKey: string;
  defaultAccountPassword: string;
  extensionPassword: string;
  resumeFolderPath: string;
  timeline: CareerEntry[];
};

/** The model every Acorn AI call uses. The profile stores the key, not a choice of model. */
export const AI_MODEL_LABEL = "OpenRouter, GPT-6 Luna";

const choice = (labels: string[]) => labels.map((label) => ({ value: label, label }));

export const GENDER_OPTIONS = choice(["Female", "Male", "Non-binary", "Decline to answer"]);
export const PRONOUN_OPTIONS = choice(["she/her", "he/him", "they/them", "Decline to answer"]);
export const ORIENTATION_OPTIONS = choice([
  "Heterosexual",
  "Gay or lesbian",
  "Bisexual",
  "Decline to answer",
]);
export const HISPANIC_OPTIONS = choice(["Yes", "No", "Decline to answer"]);
export const RACE_OPTIONS = choice([
  "Asian",
  "Black or African American",
  "Hispanic or Latino",
  "White",
  "Two or more races",
  "Decline to answer",
]);
export const VISA_OPTIONS = choice([
  "No — no sponsorship",
  "Yes — will require sponsorship",
  "Decline to answer",
]);
export const DISABILITY_OPTIONS = choice([
  "No — no disability",
  "Yes — I have a disability",
  "Decline to answer",
]);
export const VETERAN_OPTIONS = choice([
  "I am not a protected veteran",
  "I am a protected veteran",
  "Decline to answer",
]);
export const CITIZENSHIP_OPTIONS = choice([
  "U.S. Citizen",
  "Permanent resident",
  "Work visa",
  "Other",
]);
export const YES_NO_OPTIONS = choice(["Yes", "No"]);
export const PUBLIC_TRUST_OPTIONS = choice([
  "None",
  "Active public trust",
  "Eligible and willing to obtain",
  "Not eligible",
  "Decline to answer",
]);
export const CLEARANCE_OPTIONS = choice(["None", "Secret", "Top Secret", "TS/SCI"]);
export const RELOCATE_OPTIONS = choice(["Yes", "No", "Depends on the role"]);
export const WORK_MODE_OPTIONS = choice(["Remote", "Hybrid", "On-site", "Open to any"]);
export const TRAVEL_OPTIONS = choice(["None", "Up to 25%", "Up to 50%", "More than 50%"]);
export const NOTICE_OPTIONS = choice(["Immediately", "2 weeks", "1 month", "2 months or more"]);
export const COUNTRY_OPTIONS = choice(["United States", "Canada", "United Kingdom", "Other"]);

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const MONTH_OPTIONS = MONTH_NAMES.map((label, index) => ({
  value: String(index + 1),
  label,
}));

export const YEAR_OPTIONS = Array.from({ length: YEAR_SPAN }, (_, index) => {
  const value = String(new Date().getFullYear() - index);
  return { value, label: value };
});

export function sampleProfile(account: AcornAccount): ApplicantProfile {
  const parts = account.name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? account.name;
  const middleName = parts.length > 2 ? parts[1] : "";
  const lastName = parts.slice(parts.length > 2 ? 2 : 1).join(" ");
  return {
    fullName: account.name,
    firstName,
    middleName,
    lastName,
    headline: "Senior Software Engineer",
    age: "32",
    gender: "Male",
    pronouns: "they/them",
    orientation: "Heterosexual",
    email: account.email,
    phone: "(415) 555-0148",
    street: "100 Market Street",
    city: "San Francisco",
    state: "CA",
    citizenship: "U.S. Citizen",
    country: "United States",
    zip: "94105",
    linkedin: "https://www.linkedin.com/in/sample",
    github: "https://github.com/sample",
    portfolio: "https://sample.dev",
    hispanicLatino: "No",
    raceEthnicity: "Decline to answer",
    visaSponsorship: "No — no sponsorship",
    workAuthorized: "Yes",
    publicTrust: "Eligible and willing to obtain",
    securityClearance: "None",
    over18: "Yes",
    backgroundCheck: "Yes",
    willingToRelocate: "Depends on the role",
    workModePreference: "Open to any",
    willingToTravel: "Up to 25%",
    noticePeriod: "2 weeks",
    disability: "No — no disability",
    veteranStatus: "I am not a protected veteran",
    desiredSalary: "150000",
    openrouterApiKey: "",
    defaultAccountPassword: "sample-account-password",
    extensionPassword: "",
    resumeFolderPath: "~/Documents/Resumes",
    timeline: [
      {
        id: "role-northwind",
        kind: "role",
        title: "Senior Software Engineer",
        org: "Northwind",
        location: "San Francisco, CA",
        summary: "Hiring tools, application flow, and the resume the extension attaches.",
        startMonth: "1",
        startYear: "2022",
        endMonth: "",
        endYear: "",
        current: true,
      },
      {
        id: "role-lumen",
        kind: "role",
        title: "Software Engineer",
        org: "Lumen",
        location: "Oakland, CA",
        summary: "Product surfaces for search, profiles, and mail.",
        startMonth: "3",
        startYear: "2018",
        endMonth: "12",
        endYear: "2021",
        current: false,
      },
      {
        id: "role-harbor",
        kind: "role",
        title: "Software Engineer",
        org: "Harbor Health",
        location: "Seattle, WA",
        summary: "Patient scheduling and the internal tools around it.",
        startMonth: "6",
        startYear: "2015",
        endMonth: "2",
        endYear: "2018",
        current: false,
      },
      {
        id: "edu-state",
        kind: "education",
        title: "B.S. Computer Science",
        org: "State University",
        location: "",
        summary: "",
        startMonth: "9",
        startYear: "2011",
        endMonth: "5",
        endYear: "2015",
        current: false,
      },
    ],
  };
}

/** Answers added after a profile may already have been saved; old profiles get these. */
const LATER_FIELDS = {
  middleName: "",
  headline: "",
  workAuthorized: "",
  publicTrust: "",
  securityClearance: "",
  over18: "",
  backgroundCheck: "",
  willingToRelocate: "",
  workModePreference: "",
  willingToTravel: "",
  noticePeriod: "",
  openrouterApiKey: "",
  extensionPassword: "",
} satisfies Partial<ApplicantProfile>;

/** What an empty answer starts as. Matches the backend's defaults. */
const ANSWER_DEFAULTS = {
  gender: "Male",
  orientation: "Heterosexual",
  publicTrust: "None",
  securityClearance: "None",
  willingToRelocate: "Yes",
  workModePreference: "Remote",
  willingToTravel: "None",
  noticePeriod: "Immediately",
  hispanicLatino: "No",
  raceEthnicity: "White",
  citizenship: "U.S. Citizen",
  visaSponsorship: "No — no sponsorship",
  over18: "Yes",
  backgroundCheck: "Yes",
  disability: "No — no disability",
  veteranStatus: "I am not a protected veteran",
} satisfies Partial<ApplicantProfile>;

/** A stored profile with every field present, whichever version saved it. */
export function withDefaults(profile: ApplicantProfile): ApplicantProfile {
  const next = { ...LATER_FIELDS, ...profile };
  next.timeline = (next.timeline ?? []).map((entry) => ({
    ...entry,
    location: entry.location ?? "",
  }));
  for (const [key, value] of Object.entries(ANSWER_DEFAULTS) as [
    keyof typeof ANSWER_DEFAULTS,
    string,
  ][]) {
    if (!next[key]?.trim()) next[key] = value;
  }
  return next;
}

export function isApplicantProfile(value: unknown): value is ApplicantProfile {
  return Boolean(value && typeof value === "object" && "timeline" in value && "firstName" in value);
}

export function blankEntry(kind: EntryKind): CareerEntry {
  return {
    id: crypto.randomUUID(),
    kind,
    title: "",
    org: "",
    location: "",
    summary: "",
    startMonth: "",
    startYear: String(new Date().getFullYear()),
    endMonth: "",
    endYear: "",
    current: kind === "role",
  };
}

const monthName = (month: string) => MONTH_NAMES[Number(month) - 1] ?? "";
const monthYear = (month: string, year: string) =>
  [monthName(month), year].filter(Boolean).join(" ");

/** "Mar 2025 – Present", "2009 – May 2013", "May 2019". */
export function entryPeriod(entry: CareerEntry) {
  const start = monthYear(entry.startMonth, entry.startYear);
  const end = entry.current ? "Present" : monthYear(entry.endMonth, entry.endYear);
  return [start, end].filter(Boolean).join(" – ");
}

const startKey = (entry: CareerEntry) =>
  Number(entry.startYear || entry.endYear || 0) * MONTHS_PER_YEAR + Number(entry.startMonth || 0);

/** One kind of timeline entry, most recent first; a current role leads. */
export function entriesOf(profile: ApplicantProfile, kind: EntryKind) {
  return profile.timeline
    .filter((entry) => entry.kind === kind)
    .sort((a, b) => Number(b.current) - Number(a.current) || startKey(b) - startKey(a));
}

/** The bullets of a role summary, one per line. */
export const highlightsOf = (entry: CareerEntry) =>
  entry.summary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Up to two initials for a company or school mark: "Amazon Web Services" → "AW". */
export function initialsOf(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function entryDates(entry: CareerEntry) {
  const start = `${entry.startYear}.${entry.startMonth}`;
  if (entry.current) return `${start} – present`;
  if (!entry.endYear) return start;
  return `${start} – ${entry.endYear}.${entry.endMonth}`;
}

export type ChecklistItem = { label: string; done: boolean };

/** What an application usually asks for, and whether the profile answers it. */
export function profileChecklist(profile: ApplicantProfile): ChecklistItem[] {
  const filled = (value: string) => value.trim().length > 0;
  return [
    {
      label: "Name and contact",
      done: filled(profile.fullName) && filled(profile.email) && filled(profile.phone),
    },
    {
      label: "Address",
      done: filled(profile.street) && filled(profile.city) && filled(profile.zip),
    },
    { label: "LinkedIn", done: filled(profile.linkedin) },
    { label: "GitHub or portfolio", done: filled(profile.github) || filled(profile.portfolio) },
    {
      label: "Work authorization",
      done:
        filled(profile.citizenship) &&
        filled(profile.visaSponsorship) &&
        filled(profile.workAuthorized),
    },
    {
      label: "Screening questions",
      done: [
        profile.publicTrust,
        profile.securityClearance,
        profile.over18,
        profile.noticePeriod,
      ].every(filled),
    },
    { label: "Desired salary", done: filled(profile.desiredSalary) },
    {
      label: "Two or more roles",
      done: profile.timeline.filter((entry) => entry.kind === "role").length >= 2,
    },
    { label: "Education", done: profile.timeline.some((entry) => entry.kind === "education") },
    {
      label: "Role summaries",
      done: profile.timeline
        .filter((entry) => entry.kind === "role")
        .every((entry) => filled(entry.summary)),
    },
    { label: "AI model key", done: filled(profile.openrouterApiKey) },
  ];
}

export function completeness(items: ChecklistItem[]) {
  return items.length
    ? Math.round((items.filter((item) => item.done).length / items.length) * 100)
    : 0;
}

/** Months between a role's start and its end, or today for a current role. */
export function monthsInRole(entry: CareerEntry, today: Date) {
  if (!entry.startYear) return 0;
  const start = Number(entry.startYear) * MONTHS_PER_YEAR + Number(entry.startMonth || 1);
  const end = entry.current
    ? today.getFullYear() * MONTHS_PER_YEAR + today.getMonth() + 1
    : Number(entry.endYear || entry.startYear) * MONTHS_PER_YEAR + Number(entry.endMonth || 1);
  return Math.max(0, end - start);
}

/** Months across every role, counting overlaps once per role. */
export function experienceMonths(profile: ApplicantProfile, today: Date) {
  return profile.timeline
    .filter((entry) => entry.kind === "role")
    .reduce((total, entry) => total + monthsInRole(entry, today), 0);
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;

/** "11 years 3 months", "8 months", "2 years". */
export function formatDuration(months: number) {
  const years = Math.floor(months / MONTHS_PER_YEAR);
  const rest = months % MONTHS_PER_YEAR;
  if (years === 0) return plural(rest, "month");
  return rest === 0 ? plural(years, "year") : `${plural(years, "year")} ${plural(rest, "month")}`;
}

/** Sets one profile answer; every profile form takes this. */
export type SetProfileField = <K extends keyof ApplicantProfile>(
  key: K,
  value: ApplicantProfile[K],
) => void;
