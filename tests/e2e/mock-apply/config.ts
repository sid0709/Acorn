// Settings shared by the e2e setup and run. Hosts come from @acorn/shared; every
// value can be overridden from the environment.
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acornHosts } from "../../../acorn/packages/shared/api";

/** The local acorn-backend the extension talks to during the test. */
export const API_URL = (process.env.E2E_ACORN_API_URL || acornHosts("development").api).replace(
  /\/$/,
  "",
);

/** The built extension the headless browser loads (run `bun run build:acorn` first). */
export const EXTENSION_DIR = join(import.meta.dir, "../../../acorn/extension/dist");

/** The local test account, made by setup.ts. Holds generated test credentials only; git-ignored. */
export const ACCOUNT_FILE = join(import.meta.dir, ".e2e-account.json");

/** The sample résumé the test applicant's Library holds. */
export const RESUME_FILE = join(import.meta.dir, "fixtures/sample-resume.docx");

/** Where screenshots go; override with E2E_OUT_DIR. */
export const OUT_DIR = process.env.E2E_OUT_DIR || join(tmpdir(), "acorn-e2e-mock-apply");

/** The longest one run may take before the test gives up. */
export const RUN_TIMEOUT_MS = 20 * 60_000;
/** How often the test looks at the page and the run's progress. */
export const POLL_MS = 500;

export interface E2EAccount {
  name: string;
  email: string;
  /** The Acorn sign-in password of this local test account. */
  password: string;
  /** The test applicant's default password for job-site accounts. */
  sitePassword: string;
}

export async function readAccount(): Promise<E2EAccount | null> {
  const file = Bun.file(ACCOUNT_FILE);
  return (await file.exists()) ? ((await file.json()) as E2EAccount) : null;
}

/** Calls the local Acorn API; throws with the API's own message on failure. */
export async function api<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(`${path}: ${data.error || data.message || res.status}`);
  return data;
}

export async function signIn(account: E2EAccount): Promise<string> {
  const res = await api<{ token?: string; session?: { token?: string } }>("/acorn/auth/signin", {
    method: "POST",
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const token = res.token ?? res.session?.token;
  if (!token) throw new Error("sign-in returned no token");
  return token;
}
