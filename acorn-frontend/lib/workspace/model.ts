import type { AcornAccount } from "@/lib/auth/session";
import { isApplicantProfile, withDefaults, type ApplicantProfile } from "./profile";

export const WORKSPACE_STORAGE_KEY = "acorn.workspace.v2";
const WORKSPACE_CHANGE = "acorn-workspace-change";

/** The signed-in account this tab's workspace belongs to. A support session uses the user's id. */
let boundAccountId = "";
let boundSupport = false;

function storageKey() {
  return boundAccountId ? `${WORKSPACE_STORAGE_KEY}:${boundAccountId}` : WORKSPACE_STORAGE_KEY;
}

/**
 * Points workspace storage at this account before children read it.
 * A support session does not inherit another account's browser cache, so edits
 * start from the user's saved profile and save back to that account.
 */
export function bindWorkspaceAccount(accountId: string, support: boolean) {
  const nextId = accountId.trim();
  if (boundAccountId === nextId && boundSupport === support) return;
  boundAccountId = nextId;
  boundSupport = support;
  snapshotRaw = null;
  snapshot = EMPTY_WORKSPACE;
  if (typeof window === "undefined" || support || !nextId) return;
  const key = storageKey();
  if (!localStorage.getItem(key)) {
    const legacy = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (legacy) localStorage.setItem(key, legacy);
  }
}

const EMPTY_WORKSPACE: Workspace = {
  profile: null,
  resumes: [],
  library: [],
  mailboxes: [],
  readMail: [],
};

export const HEADLINE_MAX = 80;
export const SUMMARY_MAX = 600;
export const ROLE_MAX = 80;
export const COMPANY_MAX = 80;
export const LOCATION_MAX = 80;
export const PHONE_MAX = 32;
export const JOB_DESCRIPTION_MAX = 4000;
export const MAILBOX_LABEL_MAX = 40;
export const RESUME_LIMIT = 12;
export const JOB_DESCRIPTION_ROWS = 8;
export const SUMMARY_ROWS = 5;

export type ResumeDraft = {
  id: string;
  role: string;
  company: string;
  summary: string;
  focus: string[];
  createdAt: string;
};

/** A résumé file you uploaded. Generated drafts live in `resumes` (History), never here. */
export type LibraryResume = {
  id: string;
  name: string;
  detail: string;
  addedAt: string;
  /** Bytes; absent on files added before sizes were kept. */
  size?: number;
  /** The file Acorn attaches when a posting has no generated draft. */
  isDefault?: boolean;
};

export const LIBRARY_LIMIT = 20;

/** Early versions kept generated drafts in the library too; those belong to History. */
function uploadsOnly(items: unknown[]): LibraryResume[] {
  return items.filter(
    (item): item is LibraryResume =>
      Boolean(item && typeof item === "object" && "name" in item) &&
      (item as { source?: string }).source !== "generated",
  );
}

export type Mailbox = {
  id: string;
  email: string;
  /** The Google account's name and photo, saved when it connected. */
  name: string;
  picture: string;
  label: string;
  isDefault: boolean;
  watchesApplications: boolean;
  /** The Gmail grant can apply labels. Older connections need to allow it again. */
  canModify: boolean;
  connectedAt: string;
};

export type Workspace = {
  profile: ApplicantProfile | null;
  resumes: ResumeDraft[];
  library: LibraryResume[];
  mailboxes: Mailbox[];
  /** Gmail message ids opened in Acorn. This only changes how Acorn draws the row. */
  readMail: string[];
};

export function emptyWorkspace(): Workspace {
  return EMPTY_WORKSPACE;
}

function parseWorkspace(raw: string): Workspace {
  try {
    const parsed = JSON.parse(raw) as Partial<Workspace>;
    return {
      profile: isApplicantProfile(parsed.profile) ? withDefaults(parsed.profile) : null,
      resumes: Array.isArray(parsed.resumes) ? parsed.resumes : [],
      library: Array.isArray(parsed.library) ? uploadsOnly(parsed.library) : [],
      mailboxes: Array.isArray(parsed.mailboxes) ? parsed.mailboxes : [],
      readMail: Array.isArray(parsed.readMail) ? parsed.readMail : [],
    };
  } catch {
    return EMPTY_WORKSPACE;
  }
}

let snapshotRaw: string | null = null;
let snapshot: Workspace = EMPTY_WORKSPACE;

/** Cached browser snapshot. Same reference until the stored JSON changes. */
export function readWorkspaceSnapshot(): Workspace {
  const raw = localStorage.getItem(storageKey());
  if (raw === snapshotRaw) return snapshot;
  snapshotRaw = raw;
  snapshot = raw ? parseWorkspace(raw) : EMPTY_WORKSPACE;
  return snapshot;
}

export function subscribeWorkspace(onChange: () => void) {
  window.addEventListener(WORKSPACE_CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(WORKSPACE_CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function clearWorkspaceStorage() {
  localStorage.removeItem(storageKey());
  localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

export function writeWorkspace(workspace: Workspace) {
  localStorage.setItem(storageKey(), JSON.stringify(workspace));
  snapshotRaw = null;
  window.dispatchEvent(new Event(WORKSPACE_CHANGE));
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

export function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function isEmail(value: string) {
  const email = value.trim().toLowerCase();
  return email.length > 3 && email.length <= 254 && email.includes("@") && email.includes(".");
}

/** A local draft from the profile and the role. The model API is not called. */
export function buildResume(
  account: AcornAccount,
  profile: ApplicantProfile,
  role: string,
  company: string,
  description: string,
): ResumeDraft {
  const cleanRole = role.trim();
  const cleanCompany = company.trim();
  const headline = profile.timeline.find((entry) => entry.kind === "role")?.title || cleanRole;
  const where = cleanCompany ? ` at ${cleanCompany}` : "";
  const base =
    profile.timeline.find((entry) => entry.summary.trim())?.summary ||
    `${account.name} is targeting ${cleanRole} roles and applies with a resume written for that posting.`;
  const focus = description
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 12)
    .slice(0, 4);
  return {
    id: crypto.randomUUID(),
    role: cleanRole,
    company: cleanCompany,
    summary: `${headline}. ${base} This draft is aimed at ${cleanRole}${where}.`,
    focus,
    createdAt: new Date().toISOString(),
  };
}
