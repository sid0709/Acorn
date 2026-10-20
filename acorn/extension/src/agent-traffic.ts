import type { TabLogEntry } from "./tab-log-session";

/**
 * Where an Agent Run's bytes and time went, hop by hop, for the run's summary:
 *
 * - A: the extension's step requests to the agent (the screenshot goes up)
 * - D: the agent's step answers back (the trace comes with them)
 * - B: the agent's requests to the driving model
 * - C: the agent's requests to the decision model
 * - E: a résumé file, from the extension through the agent to acorn-backend
 *
 * A, D and E come from the `agent-http` entries the extension logged; B and C from the requests
 * each model call recorded in its `.model.json`.
 */

const HTTP_TITLE = "agent-http";
const RESUME_TITLE = "agent-resume";
const DECISION_KIND = "decision";
const BYTES_PER_KB = 1024;
const MS_PER_S = 1000;

type Body = {
  systemBytes?: number;
  historyTextBytes?: number;
  currentTextBytes?: number;
  historyImages?: number;
  historyImageBytes?: number;
  currentImages?: number;
  currentImageBytes?: number;
};

type ModelRequest = {
  proto?: string;
  sendMs?: number;
  requestBytes?: number;
  responseBytes?: number;
  body?: Body;
};

type ModelCall = { kind?: string; requests?: ModelRequest[] };

type HttpRow = {
  method?: string;
  route?: string;
  ms?: number;
  requestBytes?: number;
  responseBytes?: number;
  serverMs?: number;
  networkMs?: number;
  serverTiming?: string;
};

function kb(bytes: number): string {
  return `${Math.round(bytes / BYTES_PER_KB)} KB`;
}

function secs(ms: number): string {
  return `${(ms / MS_PER_S).toFixed(1)}s`;
}

function parse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** One model's requests: how many, how big, how fast they went out, and the largest one taken apart. */
function modelLine(label: string, requests: readonly ModelRequest[]): string | null {
  const sized = requests.filter((request) => (request.requestBytes ?? 0) > 0);
  if (!sized.length) return null;
  const sent = sized.reduce((sum, request) => sum + (request.requestBytes ?? 0), 0);
  const received = sized.reduce((sum, request) => sum + (request.responseBytes ?? 0), 0);
  const sendMs = sized.reduce((sum, request) => sum + (request.sendMs ?? 0), 0);
  const protos = [...new Set(sized.map((request) => request.proto).filter(Boolean))].join(",");
  const rate = sendMs ? kb((sent * MS_PER_S) / sendMs) : "-";
  const head = `${label}: ${sized.length} requests, ${kb(sent)} sent, ${kb(received)} received, sending took ${secs(sendMs)} (${rate}/s), protocol ${protos || "-"}`;
  const largest = sized.reduce((a, b) => ((b.requestBytes ?? 0) > (a.requestBytes ?? 0) ? b : a));
  const body = largest.body;
  if (!body) return head;
  const text = (body.historyTextBytes ?? 0) + (body.currentTextBytes ?? 0);
  const images = (body.historyImages ?? 0) + (body.currentImages ?? 0);
  const imageBytes = (body.historyImageBytes ?? 0) + (body.currentImageBytes ?? 0);
  return `${head}\n    largest ${kb(largest.requestBytes ?? 0)} = system ${kb(body.systemBytes ?? 0)} + text ${kb(text)} + ${images} images ${kb(imageBytes)} (${body.historyImages ?? 0} in the history, ${kb(body.historyImageBytes ?? 0)})`;
}

type TimingEntry = { name: string; ms?: number; desc?: string };

/** A `Server-Timing` header's entries: `name;dur=12.3;desc="text"`. */
export function parseServerTiming(header: string): TimingEntry[] {
  return header
    .split(", ")
    .map((entry) => {
      const [name, ...params] = entry.split(";");
      const out: TimingEntry = { name: name.trim() };
      for (const param of params) {
        const [key, ...rest] = param.split("=");
        const value = rest.join("=").replace(/^"|"$/g, "");
        if (key.trim() === "dur" && Number.isFinite(Number(value))) out.ms = Number(value);
        if (key.trim() === "desc") out.desc = value;
      }
      return out;
    })
    .filter((entry) => entry.name);
}

/** Entries of several headers, a name seen twice adding up; the last description is kept. */
function sumTimings(headers: readonly string[]): TimingEntry[] {
  const byName = new Map<string, TimingEntry>();
  for (const header of headers) {
    for (const entry of parseServerTiming(header)) {
      const have = byName.get(entry.name) ?? { name: entry.name };
      byName.set(entry.name, {
        name: entry.name,
        ms: (have.ms ?? 0) + (entry.ms ?? 0),
        desc: entry.desc ?? have.desc,
      });
    }
  }
  return [...byName.values()];
}

function timingText(entries: readonly TimingEntry[]): string {
  return entries
    .map((entry) => `${entry.name} ${secs(entry.ms ?? 0)}${entry.desc ? ` (${entry.desc})` : ""}`)
    .join(", ");
}

function sum(rows: readonly HttpRow[], pick: (row: HttpRow) => number | undefined): number {
  return rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
}

/** The lines of a run's summary that account for its traffic; empty when nothing was recorded. */
export function trafficLines(
  modelFiles: readonly string[],
  logEntries: readonly TabLogEntry[],
): string[] {
  const driving: ModelRequest[] = [];
  const deciding: ModelRequest[] = [];
  for (const file of modelFiles) {
    for (const call of parse<ModelCall[]>(file) ?? []) {
      (call.kind === DECISION_KIND ? deciding : driving).push(...(call.requests ?? []));
    }
  }
  const rows: HttpRow[] = [];
  const encodeMs: number[] = [];
  for (const entry of logEntries) {
    if (entry.title.includes(HTTP_TITLE)) {
      const row = parse<HttpRow>(entry.text);
      if (row) rows.push(row);
    } else if (entry.title.includes(RESUME_TITLE)) {
      encodeMs.push(parse<{ encodeMs?: number }>(entry.text)?.encodeMs ?? 0);
    }
  }
  const lines: string[] = [];
  const steps = rows.filter((row) => row.route?.endsWith("/step"));
  if (steps.length) {
    lines.push(
      `A extension to agent: ${steps.length} step requests, ${kb(sum(steps, (r) => r.requestBytes))} sent, network time ${secs(sum(steps, (r) => r.networkMs))}`,
      `D agent to extension: ${kb(sum(steps, (r) => r.responseBytes))} received in the step answers`,
    );
  }
  const driven = modelLine("B driving model", driving);
  if (driven) lines.push(driven);
  const decided = modelLine("C decision model", deciding);
  if (decided) lines.push(decided);
  const start = rows.filter((row) => row.method === "POST" && row.route?.endsWith("/sessions"));
  if (start.length) {
    const backend = timingText(sumTimings(start.flatMap((row) => row.serverTiming ?? [])));
    lines.push(
      `session start: ${secs(sum(start, (r) => r.ms))} (agent ${secs(sum(start, (r) => r.serverMs))}, network ${secs(sum(start, (r) => r.networkMs))})${backend ? `; ${backend}` : ""}`,
    );
  }
  const files = rows.filter((row) => row.route?.includes("/resume"));
  if (files.length) {
    const backend = timingText(sumTimings(files.flatMap((row) => row.serverTiming ?? [])));
    lines.push(
      `E résumé files: ${files.length} fetched, ${kb(sum(files, (r) => r.responseBytes))}, ${secs(sum(files, (r) => r.ms))} in all (agent ${secs(sum(files, (r) => r.serverMs))}, network ${secs(sum(files, (r) => r.networkMs))}), base64 ${secs(encodeMs.reduce((a, b) => a + b, 0))}${backend ? `; ${backend}` : ""}`,
    );
  }
  return lines;
}
