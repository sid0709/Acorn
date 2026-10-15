/**
 * Whether the run is getting anywhere on a page. What a page still needs — fields
 * it flags, required fields still empty, the requirement it names — must shrink
 * from one round of work to the next at the same address. Rounds that leave all
 * of it standing are a run going in circles, however much the page redrew in
 * between (an entry form opened and closed again reads as a change, not progress).
 */

import { hasNewLinkedMessage, type FieldIssueScan } from "@acorn/shared/field-issues";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * What the page still needs, by name: each field it flags or leaves required and
 * empty, and the requirement the decision model named. Help text and page-level
 * notices are left out: a page shows them whatever the run does.
 */
export function pageNeeds(
  scan: FieldIssueScan,
  requirement?: string | null,
  before: FieldIssueScan | null = null,
): string[] {
  const needs = new Map<string, string>();
  const add = (name: string) => {
    const key = normalize(name);
    if (key && !needs.has(key)) needs.set(key, name.replace(/\s+/g, " ").trim());
  };
  for (const issue of scan.issues) {
    // With the page as it stood before the run's work, help text it always links to a field
    // is not a need; without it, any linked message counts.
    const flagged =
      issue.invalid ||
      (before ? hasNewLinkedMessage(before, issue) : issue.linkedMessages.length > 0);
    if (flagged || (issue.required && !issue.value.trim())) add(issue.label);
  }
  if (requirement) add(requirement);
  return [...needs.values()];
}

/** What the ledger last saw at one address. */
interface Seen {
  needs: Set<string>;
  stalls: number;
}

/** Rounds of work at each address, and whether each one settled anything the page needed. */
export class ProgressLedger {
  private readonly byAddress = new Map<string, Seen>();

  /**
   * Note what the page at `address` needs after a round of work. Returns how many
   * rounds in a row settled none of what it needed before them: 0 once anything was
   * settled, or when the page needs nothing, or when it newly needs something.
   */
  note(address: string, needs: string[]): number {
    const before = this.byAddress.get(address);
    const now = new Set(needs.map(normalize).filter(Boolean));
    const stuck =
      before != null && before.needs.size > 0 && [...before.needs].every((need) => now.has(need));
    const stalls = stuck ? before.stalls + 1 : 0;
    this.byAddress.set(address, { needs: now, stalls });
    return stalls;
  }

  /** The application moved to another step at this address: its rounds start over. */
  forget(address: string): void {
    this.byAddress.delete(address);
  }
}
