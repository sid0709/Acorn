// The link file the live runner reads: one job link per line, `#` starts a comment, and an optional
// `expect=<outcome>` after the link says how the run should end there.

/** How one attempt on a link ended. `sent` must never happen: the runner holds every run before Submit. */
export const OUTCOME = {
  ready: "ready",
  unavailable: "unavailable",
  needPerson: "need_person",
  stuck: "stuck",
  stepLimit: "step_limit",
  error: "error",
  sent: "sent",
} as const;
export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];
export const OUTCOMES: readonly Outcome[] = Object.values(OUTCOME);

/** The outcomes a link may be expected to end with (`sent` is never expected). */
const EXPECTABLE: readonly Outcome[] = OUTCOMES.filter((outcome) => outcome !== OUTCOME.sent);

export interface LinkEntry {
  /** The line of the file, from 1, so a report can point back to it. */
  line: number;
  url: string;
  host: string;
  expect?: Outcome;
}

/** A link file that cannot be used, saying which line is wrong. */
export class LinkFileError extends Error {
  constructor(
    readonly line: number,
    detail: string,
  ) {
    super(`line ${line}: ${detail}`);
    this.name = "LinkFileError";
  }
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.host : null;
  } catch {
    return null;
  }
}

/** Reads the file. Throws LinkFileError for a line that is not a link, a repeat, or a bad option. */
export function parseLinkFile(text: string): LinkEntry[] {
  const links: LinkEntry[] = [];
  const seen = new Map<string, number>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const content = raw.replace(/#.*$/, "").trim();
    if (!content) return;
    const [url, ...options] = content.split(/\s+/);
    const host = hostOf(url);
    if (!host) throw new LinkFileError(line, `${JSON.stringify(url)} is not an http or https link`);
    const before = seen.get(url);
    if (before != null) throw new LinkFileError(line, `repeats the link of line ${before}`);
    seen.set(url, line);
    const entry: LinkEntry = { line, url, host };
    for (const option of options) {
      const [key, value] = option.split("=", 2);
      if (key !== "expect" || value === undefined) {
        throw new LinkFileError(
          line,
          `unknown option ${JSON.stringify(option)}; only expect=<outcome> is allowed`,
        );
      }
      if (!EXPECTABLE.includes(value as Outcome)) {
        throw new LinkFileError(line, `expect=${value} is not one of ${EXPECTABLE.join(", ")}`);
      }
      entry.expect = value as Outcome;
    }
    links.push(entry);
  });
  return links;
}

/** The links whose host holds `only` (case does not matter); every link when `only` is empty. */
export function onlyHost(links: LinkEntry[], only: string | undefined): LinkEntry[] {
  const needle = (only ?? "").trim().toLowerCase();
  if (!needle) return links;
  return links.filter((link) => link.host.toLowerCase().includes(needle));
}
