// What every end-to-end run of the agent needs, shared by the fake-site run (run.ts) and the live runner
// (../live/run.ts): a port nothing listens on, a build of the extension that talks to the agent at that
// port, a build of the agent server, the agent process and its health check, a real Chrome with the
// extension loaded, and the extension's own page as a place to send it messages from.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import puppeteer, { TargetType, type Browser, type Page } from "puppeteer";

import { AGENT_ROUTES } from "../../../acorn/packages/shared/agent-contract";

import type { AgentHealth } from "../../../acorn/packages/shared/agent-contract";

export const AGENT_DIR = join(import.meta.dir, "../../../acorn-agent");
export const EXTENSION_SRC = join(import.meta.dir, "../../../acorn/extension");

/** The window the agent works in, the size a person's would be. */
export const VIEWPORT = { width: 1280, height: 800 };

/** How long the agent server gets to answer its health route after it starts. */
const AGENT_START_TIMEOUT_MS = 5_000;
const AGENT_START_POLL_MS = 100;

export const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A port nothing is listening on, found by asking the system for one. */
export function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = probe.port ?? 0;
  void probe.stop(true);
  return port;
}

/** Builds the extension into a fresh folder, pointed at the agent at agentUrl. */
export async function buildExtension(agentUrl: string): Promise<string> {
  const extensionDir = await mkdtemp(join(tmpdir(), "acorn-agent-e2e-extension-"));
  const build = Bun.spawnSync(
    ["bunx", "vite", "build", "--outDir", extensionDir, "--emptyOutDir"],
    {
      cwd: EXTENSION_SRC,
      env: { ...process.env, VITE_ACORN_AGENT_URL: agentUrl },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  if (build.exitCode !== 0) throw new Error(`extension build failed: ${build.stderr.toString()}`);
  return extensionDir;
}

/** Builds the agent server binary at binary. */
export function buildAgent(binary: string): void {
  const build = Bun.spawnSync(["go", "build", "-o", binary, "./cmd/agent"], {
    cwd: AGENT_DIR,
    stderr: "pipe",
  });
  if (build.exitCode !== 0) throw new Error(`go build failed: ${build.stderr.toString()}`);
}

export type AgentProcess = ReturnType<typeof Bun.spawn>;

/**
 * Starts the agent server at agentUrl with this environment (on top of the process's own) and waits for
 * its health route. The server reads `.env` from cwd; a variable given here wins over the file.
 */
export async function startAgent(
  binary: string,
  agentUrl: string,
  env: Record<string, string>,
  cwd: string,
): Promise<AgentProcess> {
  const agent = Bun.spawn([binary], {
    cwd,
    env: { ...process.env, HTTP_ADDR: new URL(agentUrl).host, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  await waitForAgent(agent, agentUrl);
  return agent;
}

export async function waitForAgent(agent: AgentProcess, agentUrl: string): Promise<void> {
  for (let waited = 0; waited < AGENT_START_TIMEOUT_MS; waited += AGENT_START_POLL_MS) {
    if (agent.exitCode !== null) throw new Error("the agent server stopped at start");
    try {
      if ((await fetch(agentUrl + AGENT_ROUTES.health)).ok) return;
    } catch {
      /* not up yet */
    }
    await pause(AGENT_START_POLL_MS);
  }
  throw new Error("the agent server did not start");
}

/** What the agent server says of itself. */
export async function agentHealth(agentUrl: string): Promise<AgentHealth> {
  const response = await fetch(agentUrl + AGENT_ROUTES.health);
  if (!response.ok) throw new Error(`health answered ${response.status}`);
  return (await response.json()) as AgentHealth;
}

/**
 * A real Chrome with the extension loaded. The window itself is the size of the page, as it is for a
 * person: an emulated size would give the page one size and the agent's own screenshot another. Two
 * device pixels to a CSS pixel, as on the machine the agent runs on, so a screenshot taken at the page's
 * own size comes out twice as large as the viewport it is reported with, which the extension must handle.
 */
export function launchChrome(extensionDir: string, headless: boolean): Promise<Browser> {
  return puppeteer.launch({
    headless,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      "--force-device-scale-factor=2",
    ],
    defaultViewport: null,
  });
}

/**
 * The extension's own side panel page, opened as a tab: a place to call chrome.* from and to send the
 * service worker the messages the sidebar would.
 */
export async function openControlPage(
  browser: Browser,
): Promise<{ control: Page; extensionId: string }> {
  const worker = await browser.waitForTarget(
    (t) => t.type() === TargetType.SERVICE_WORKER && t.url().startsWith("chrome-extension://"),
  );
  const extensionId = new URL(worker.url()).host;
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/sidebar.html`);
  return { control, extensionId };
}
