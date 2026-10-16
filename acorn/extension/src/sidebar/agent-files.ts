import { AGENT_ZIP_FOLDER, TIMELINE_FILE, isImageName } from "../agent/trace-names";
import { LOG_KIND, type TabLogEntry } from "../tab-log-session";

/** An Agent Run's files in the log, laid out for the zip: `agent/<run>/001.json`, `001.jpg`, … */

export type AgentZipFile = { name: string; data: Uint8Array; modified: Date };

/** The folder name of a run with no id. */
const NO_RUN = "run";
const SUMMARY_FILE = "summary.txt";

export function isAgentFile(entry: Pick<TabLogEntry, "kind">): boolean {
  return entry.kind === LOG_KIND.agentFile;
}

/** Whether an entry is a picture of an Agent Run, which a support report leaves out to stay small. */
export function isAgentImage(entry: TabLogEntry): boolean {
  return isAgentFile(entry) && isImageName(entry.title);
}

function folderOf(runId: string | undefined): string {
  const safe = (runId ?? NO_RUN).replace(/[^\p{L}\p{N}_-]+/gu, "-");
  return `${AGENT_ZIP_FOLDER}/${safe || NO_RUN}`;
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** A repeated name gets a number before its extension: `001-2.json`. */
function uniqueName(taken: ReadonlySet<string>, name: string): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot < 0 ? name : name.slice(0, dot);
  const ext = dot < 0 ? "" : name.slice(dot);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

type Call = {
  kind?: string;
  latencyMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; cachedTokens?: number; cost?: number };
};

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * One run's numbers from its model files, so a slow run can be read at a glance: how many calls the
 * model made, how long they took, what they sent and cost. The same figures as the agent's tracesum.
 */
export function summarizeAgentRun(modelFiles: readonly string[], entries: number): string {
  let driving = 0;
  let drivingMs = 0;
  let checks = 0;
  let checkMs = 0;
  let input = 0;
  let output = 0;
  let cached = 0;
  let cost = 0;
  for (const text of modelFiles) {
    let calls: Call[];
    try {
      calls = JSON.parse(text) as Call[];
    } catch {
      continue;
    }
    for (const call of calls) {
      const isCheck = call.kind === "decision";
      if (isCheck) {
        checks += 1;
        checkMs += call.latencyMs ?? 0;
      } else {
        driving += 1;
        drivingMs += call.latencyMs ?? 0;
        input += call.usage?.inputTokens ?? 0;
        output += call.usage?.outputTokens ?? 0;
        cached += call.usage?.cachedTokens ?? 0;
      }
      cost += call.usage?.cost ?? 0;
    }
  }
  const per = (ms: number, n: number) => (n ? seconds(ms / n) : "-");
  return [
    `entries: ${entries}`,
    `model: ${driving} calls, ${seconds(drivingMs)} in all, ${per(drivingMs, driving)} a call`,
    `        ${input} tokens in (${cached} cached), ${output} out, ${driving ? Math.round(input / driving) : 0} in a call`,
    `checks: ${checks} calls, ${seconds(checkMs)} in all, ${per(checkMs, checks)} a call`,
    `cost: $${cost.toFixed(4)}`,
    "",
  ].join("\n");
}

/** The agent files of a log as zip files, one folder per run, with a summary and the timeline. */
export function agentZipFiles(entries: readonly TabLogEntry[]): AgentZipFile[] {
  const encoder = new TextEncoder();
  const runs = new Map<
    string,
    { files: Map<string, AgentZipFile>; models: string[]; last: number }
  >();
  for (const entry of entries) {
    if (!isAgentFile(entry)) continue;
    const folder = folderOf(entry.runId);
    let run = runs.get(folder);
    if (!run) {
      run = { files: new Map(), models: [], last: entry.t };
      runs.set(folder, run);
    }
    run.last = Math.max(run.last, entry.t);
    const modified = new Date(entry.t);
    if (entry.title === TIMELINE_FILE) {
      const path = `${folder}/${TIMELINE_FILE}`;
      const before = run.files.get(path);
      const joined = `${before ? new TextDecoder().decode(before.data) : ""}${entry.text}`;
      run.files.set(path, { name: path, data: encoder.encode(joined), modified });
      continue;
    }
    if (entry.title.endsWith(".model.json")) run.models.push(entry.text);
    const image = isImageName(entry.title);
    const data = (image ? fromBase64(entry.text) : null) ?? encoder.encode(entry.text);
    const taken = new Set([...run.files.keys()].map((path) => path.slice(folder.length + 1)));
    const name = uniqueName(taken, entry.title);
    run.files.set(`${folder}/${name}`, { name: `${folder}/${name}`, data, modified });
  }
  const out: AgentZipFile[] = [];
  for (const [folder, run] of runs) {
    const entryCount = [...run.files.keys()].filter((path) => /\/\d{3}\.json$/.test(path)).length;
    out.push({
      name: `${folder}/${SUMMARY_FILE}`,
      data: encoder.encode(summarizeAgentRun(run.models, entryCount)),
      modified: new Date(run.last),
    });
    out.push(...run.files.values());
  }
  return out;
}
