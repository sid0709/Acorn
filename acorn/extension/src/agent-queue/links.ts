import { RUN_URL_MAX } from "@acorn/shared/runs";

/** The most jobs the queue holds, finished ones included. */
export const QUEUE_MAX_ITEMS = 300;

/** The most characters of a link's host and path the list shows. */
const LABEL_MAX = 56;

export interface ParsedLinks {
  /** The new links, in the order pasted, each once. */
  links: string[];
  /** Lines whose first word was not an http or https link. */
  invalid: number;
  /** Links already in the queue, or pasted twice. */
  duplicates: number;
}

/** The address a job is queued and compared by: the link as the browser reads it. */
function normalize(token: string): string | null {
  if (token.length > RUN_URL_MAX) return null;
  try {
    const url = new URL(token);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Reads pasted job links, one per line. A line holds the link first and may go on after a space
 * ("link | title"); only the part before the first space counts. Blank lines are skipped.
 */
export function parseJobLinks(text: string, queued: Iterable<string> = []): ParsedLinks {
  const seen = new Set<string>(queued);
  const links: string[] = [];
  let invalid = 0;
  let duplicates = 0;
  for (const line of text.split(/\r?\n/)) {
    const token = line.trim().split(/\s/, 1)[0];
    if (!token) continue;
    const href = normalize(token);
    if (!href) {
      invalid += 1;
    } else if (seen.has(href)) {
      duplicates += 1;
    } else {
      seen.add(href);
      links.push(href);
    }
  }
  return { links, invalid, duplicates };
}

/** What the list calls a job: where it is, without the query. */
export function linkLabel(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    const where = `${host}${pathname === "/" ? "" : pathname}`;
    return where.length > LABEL_MAX ? `${where.slice(0, LABEL_MAX - 1)}…` : where;
  } catch {
    return url;
  }
}
