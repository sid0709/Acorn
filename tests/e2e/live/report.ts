// What the live runner records for each attempt on a link, the numbers it sums from them, and the two
// files it writes: results.json (to compare a later run against, with --baseline) and report.md.
import { OUTCOME, OUTCOMES, type Outcome } from "./links";

/** One attempt on one link. Times are seconds, cost is dollars, tokens are the driving model's. */
export interface AttemptResult {
  line: number;
  url: string;
  host: string;
  system: string;
  attempt: number;
  expect?: Outcome;
  outcome: Outcome;
  /** How the job was unavailable, when it was (the agent's kind). */
  kind?: string;
  stopReason?: string;
  message: string;
  /** Whether the outcome matched `expect`; unset when nothing was expected. */
  matched?: boolean;
  seconds: number;
  modelCalls: number;
  decisionCalls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  cost: number;
  /** Required fields the page still reported empty (or invalid) when the run stopped. */
  requiredEmpty: number;
  traceDir?: string;
  startedAt: string;
  endedAt: string;
}

export interface Summary {
  attempts: number;
  outcomes: Record<Outcome, number>;
  /** The share of attempts that ended ready to submit (0 to 1). */
  readyRate: number;
  /** Attempts with an expectation, and how many met it. */
  expected: number;
  matched: number;
  /** Attempts expected to be unavailable, how many were; and attempts that were unavailable unexpectedly. */
  unavailableExpected: number;
  unavailableFound: number;
  unavailableUnexpected: number;
  /** Unavailable accuracy: found over expected (null when none was expected). */
  unavailableAccuracy: number | null;
  medianSeconds: number;
  medianCost: number;
  totalSeconds: number;
  totalCost: number;
  requiredEmpty: number;
}

export interface Results {
  version: 1;
  startedAt: string;
  finishedAt: string;
  linksFile: string;
  repeat: number;
  agent: { model: string; stopBeforeSubmit: boolean; url: string };
  attempts: AttemptResult[];
  summary: Summary;
  systems: Record<string, Summary>;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarize(attempts: AttemptResult[]): Summary {
  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const attempt of attempts) outcomes[attempt.outcome] += 1;
  const expected = attempts.filter((a) => a.expect);
  const unavailableExpected = attempts.filter((a) => a.expect === OUTCOME.unavailable);
  const unavailableFound = unavailableExpected.filter((a) => a.outcome === OUTCOME.unavailable);
  const unavailableUnexpected = attempts.filter(
    (a) =>
      a.outcome === OUTCOME.unavailable &&
      a.expect !== undefined &&
      a.expect !== OUTCOME.unavailable,
  );
  return {
    attempts: attempts.length,
    outcomes,
    readyRate: attempts.length ? outcomes[OUTCOME.ready] / attempts.length : 0,
    expected: expected.length,
    matched: expected.filter((a) => a.matched).length,
    unavailableExpected: unavailableExpected.length,
    unavailableFound: unavailableFound.length,
    unavailableUnexpected: unavailableUnexpected.length,
    unavailableAccuracy: unavailableExpected.length
      ? unavailableFound.length / unavailableExpected.length
      : null,
    medianSeconds: median(attempts.map((a) => a.seconds)),
    medianCost: median(attempts.map((a) => a.cost)),
    totalSeconds: attempts.reduce((sum, a) => sum + a.seconds, 0),
    totalCost: attempts.reduce((sum, a) => sum + a.cost, 0),
    requiredEmpty: attempts.reduce((sum, a) => sum + a.requiredEmpty, 0),
  };
}

/** One summary per site system, in the order the systems first appear. */
export function bySystem(attempts: AttemptResult[]): Record<string, Summary> {
  const groups = new Map<string, AttemptResult[]>();
  for (const attempt of attempts) {
    groups.set(attempt.system, [...(groups.get(attempt.system) ?? []), attempt]);
  }
  return Object.fromEntries([...groups].map(([system, rows]) => [system, summarize(rows)]));
}

const percent = (share: number | null) => (share == null ? "–" : `${Math.round(share * 100)}%`);
const dollars = (cost: number) => `$${cost.toFixed(4)}`;
const seconds = (s: number) => `${Math.round(s)}s`;
const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** A number, or "before → after" when a baseline has one. */
function compare(after: string, before: string | undefined): string {
  return before === undefined || before === after ? after : `${before} → ${after}`;
}

/** The headline numbers of a summary, as the table columns the report shows. */
function summaryCells(s: Summary, base?: Summary): string[] {
  return [
    compare(String(s.attempts), base && String(base.attempts)),
    compare(percent(s.readyRate), base && percent(base.readyRate)),
    compare(
      `${s.unavailableFound}/${s.unavailableExpected}${s.unavailableUnexpected ? ` (+${s.unavailableUnexpected} unexpected)` : ""}`,
      base &&
        `${base.unavailableFound}/${base.unavailableExpected}${base.unavailableUnexpected ? ` (+${base.unavailableUnexpected} unexpected)` : ""}`,
    ),
    compare(`${s.matched}/${s.expected}`, base && `${base.matched}/${base.expected}`),
    compare(seconds(s.medianSeconds), base && seconds(base.medianSeconds)),
    compare(dollars(s.medianCost), base && dollars(base.medianCost)),
    compare(seconds(s.totalSeconds), base && seconds(base.totalSeconds)),
    compare(dollars(s.totalCost), base && dollars(base.totalCost)),
    compare(String(s.outcomes.sent), base && String(base.outcomes.sent)),
  ];
}

function linkLabel(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    const where = `${host}${pathname === "/" ? "" : pathname}`;
    return where.length > 60 ? `${where.slice(0, 59)}…` : where;
  } catch {
    return url;
  }
}

function row(cells: string[]): string {
  return `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
}

/** The report as Markdown: one row per attempt, totals per site system, and the whole run. */
export function renderReport(results: Results, baseline?: Results): string {
  const lines: string[] = [];
  lines.push(`# Live agent run`);
  lines.push("");
  lines.push(
    `${results.attempts.length} attempt${results.attempts.length === 1 ? "" : "s"} on ${new Set(results.attempts.map((a) => a.url)).size} link(s) from \`${results.linksFile}\`, ${results.repeat}× each. ` +
      `Agent at ${results.agent.url}, model ${results.agent.model || "unknown"}, stop before submit ${results.agent.stopBeforeSubmit ? "on" : "OFF"}. ` +
      `${results.startedAt} to ${results.finishedAt}.`,
  );
  if (baseline) {
    lines.push("");
    lines.push(
      `Compared with the run of ${baseline.startedAt} (\`before → after\` where a number changed).`,
    );
  }
  const sent = results.attempts.filter((a) => a.outcome === OUTCOME.sent);
  if (sent.length && results.agent.stopBeforeSubmit) {
    lines.push("");
    lines.push(`## ⚠️ ${sent.length} application${sent.length === 1 ? " was" : "s were"} SENT`);
    lines.push("");
    lines.push(
      "The agent was set to hold every run before Submit; a sent application means the guard was passed. Rows:",
    );
    for (const a of sent) lines.push(`- line ${a.line}, attempt ${a.attempt}: ${a.url}`);
  }
  lines.push("");
  lines.push("## Links");
  lines.push("");
  const head = [
    "#",
    "Link",
    "System",
    "Try",
    "Outcome",
    "Kind / stop",
    "Expected",
    "Match",
    "Seconds",
    "Model calls",
    "Decision calls",
    "Tokens (cached)",
    "Cost",
    "Required empty",
    "Trace",
    "Message",
  ];
  lines.push(row(head));
  lines.push(row(head.map(() => "---")));
  for (const a of results.attempts) {
    lines.push(
      row([
        String(a.line),
        linkLabel(a.url),
        a.system,
        String(a.attempt),
        a.outcome === OUTCOME.sent && results.agent.stopBeforeSubmit ? "**SENT**" : a.outcome,
        [a.kind, a.stopReason].filter(Boolean).join(" / ") || "–",
        a.expect ?? "–",
        a.matched === undefined ? "–" : a.matched ? "yes" : "**no**",
        seconds(a.seconds),
        String(a.modelCalls),
        String(a.decisionCalls),
        `${tokens(a.inputTokens + a.outputTokens)} (${tokens(a.cachedTokens)})`,
        dollars(a.cost),
        String(a.requiredEmpty),
        a.traceDir ? `\`${a.traceDir}\`` : "–",
        a.message.replace(/\s+/g, " ").slice(0, 120),
      ]),
    );
  }
  lines.push("");
  lines.push("## By site system");
  lines.push("");
  const totalsHead = [
    "System",
    "Attempts",
    "Ready rate",
    "Unavailable found/expected",
    "Expect matched",
    "Median seconds",
    "Median cost",
    "Total seconds",
    "Total cost",
    "Sent",
  ];
  lines.push(row(totalsHead));
  lines.push(row(totalsHead.map(() => "---")));
  for (const [system, summary] of Object.entries(results.systems)) {
    lines.push(row([system, ...summaryCells(summary, baseline?.systems[system])]));
  }
  lines.push(row(["**All**", ...summaryCells(results.summary, baseline?.summary)]));
  lines.push("");
  lines.push("## Outcomes");
  lines.push("");
  for (const outcome of OUTCOMES) {
    const count = results.summary.outcomes[outcome];
    const before = baseline?.summary.outcomes[outcome];
    if (count || before)
      lines.push(
        `- ${outcome}: ${compare(String(count), before === undefined ? undefined : String(before))}`,
      );
  }
  lines.push("");
  return lines.join("\n");
}
