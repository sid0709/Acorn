/**
 * The run as a story a person can follow: "Read the page · 493 elements", "Asked the AI
 * to read the page · 3.2 s", "Clicked Submit Application". It is a view over the tab's
 * local log, built from the entries alone (nothing is stored twice), so the Jobs tab and
 * the Logs tab can never disagree. Each item names the entries behind it, which the
 * Jobs tab opens on request.
 */

import { LOG_KIND, type TabLogEntry } from "./tab-log-session";

export type ActivityStatus = "running" | "ok" | "info" | "warn" | "error";

export type ActivityIcon =
  "read" | "ai" | "click" | "fill" | "wait" | "mail" | "tab" | "file" | "done";

export type ActivityItem = {
  id: string;
  t: number;
  /** How long the thing took, when the log says. */
  ms?: number;
  title: string;
  summary?: string;
  status: ActivityStatus;
  icon: ActivityIcon;
  runId?: string;
  page?: number;
  /** The log entries behind this item, in order. */
  entryIds: string[];
};

/** A request with no answer after this long is shown as lost, not as still going. */
const REQUEST_LOST_AFTER_MS = 120_000;
/** A story with no new entry for this long is not "running" any more. */
const STALE_AFTER_MS = 20_000;

type Data = Record<string, unknown>;

const RUN_END_TITLE: Record<string, string> = {
  completed: "Application sent",
  failed: "The run stopped",
  stopped: "You stopped the run",
  ready_to_submit: "Ready to submit",
};

function dataOf(entry: TabLogEntry): Data {
  try {
    const parsed: unknown = JSON.parse(entry.text);
    return parsed && typeof parsed === "object" ? (parsed as Data) : {};
  } catch {
    return {};
  }
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const num = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

/** `850 ms`, `3.2 s`: how long a step took, for the row. */
export function formatActivityMs(ms: number | undefined): string {
  if (ms == null) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** `Page kind` as a sentence part: "application_form" → "an application form". */
function kindName(kind: string | undefined): string {
  switch (kind) {
    case "job_posting":
    case "posting":
      return "a job posting";
    case "application_form":
    case "form":
      return "an application form";
    case "account_step":
    case "account":
      return "a sign-in or account step";
    case "confirmation":
      return "a confirmation page";
    case "blocked":
      return "a blocked page";
    default:
      return kind ? `a page (${kind.replace(/_/g, " ")})` : "the page";
  }
}

function percent(value: unknown): string {
  return typeof value === "number" ? ` (${Math.round(value * 100)}%)` : "";
}

function statusOf(entry: TabLogEntry): ActivityStatus {
  if (entry.level === "error" || entry.kind === LOG_KIND.error) return "error";
  if (entry.level === "warn") return "warn";
  return "ok";
}

/** What an API call is called while it runs and once it answered. */
function describeCall(
  name: string,
  body: Data,
): { running: string; done: string; summary?: string; icon: ActivityIcon } {
  const route = name.split(" · ")[0];
  switch (route) {
    case "run/read-page": {
      const control = body.control as Data | null | undefined;
      const parts = [
        `It looks like ${kindName(str(body.kind))}${percent(body.kindConfidence)}`,
        control
          ? `next step: ${str(control.role) ?? "a control"}${percent(control.confidence)}`
          : "no next step found",
      ];
      const verification = str(body.verification);
      if (verification && verification !== "none") parts.push(`verification: ${verification}`);
      return {
        running: "Asking the AI to read the page…",
        done: "Read the page with the AI",
        summary: parts.join(" · "),
        icon: "ai",
      };
    }
    case "run/account-outcome":
      return {
        running: "Checking how the site answered the sign-in…",
        done: "Checked how the site answered the sign-in",
        summary: str(body.outcome),
        icon: "ai",
      };
    case "run/diagnose":
      return {
        running: "Working out why the run stopped…",
        done: "Worked out why the run stopped",
        summary: [str(body.label), str(body.detail)].filter(Boolean).join(" — ") || undefined,
        icon: "ai",
      };
    case "run/dialog":
      return {
        running: "Deciding what to do with the page's dialog…",
        done: "Decided what to do with the page's dialog",
        icon: "ai",
      };
    case "run/mail-verification":
      return {
        running: "Looking in your Gmail for the site's email…",
        done: "Looked in your Gmail for the site's email",
        summary: str(body.status),
        icon: "mail",
      };
    case "ai-analyze": {
      const plan = typeof body.plan === "string" ? /(\d+) actions/.exec(body.plan)?.[1] : undefined;
      const mode = name.includes("refill") ? "refill plan" : "plan";
      return {
        running: `Asking the AI to ${mode} the form…`,
        done: plan ? `Planned ${plan} actions` : `Planned the form`,
        summary: name.includes("refill") ? "Fixing what the page flagged" : undefined,
        icon: "ai",
      };
    }
    case "pick-options":
      return {
        running: "Asking the AI to choose answers…",
        done: "Chose answers to the choice questions",
        icon: "ai",
      };
    case "match-option":
      return {
        running: "Asking the AI to pick a dropdown option…",
        done: "Picked a dropdown option",
        icon: "ai",
      };
    case "qa":
      return { running: "Asking the AI to write an answer…", done: "Wrote an answer", icon: "ai" };
    case "custom/recommend": {
      const stack = str(body.recommendedResumeStack);
      return {
        running: "Choosing the best résumé…",
        done: stack ? `Chose the résumé: ${stack}` : "Chose a résumé",
        summary: str(body.recommendedResumeReason),
        icon: "ai",
      };
    }
    case "custom/cover-letter":
      return {
        running: "Choosing a cover letter…",
        done: str(body.stack)
          ? `Chose the cover letter: ${str(body.stack)}`
          : "Chose a cover letter",
        summary: str(body.reason),
        icon: "ai",
      };
    default:
      return { running: `Calling ${route}…`, done: `Called ${route}`, icon: "ai" };
  }
}

/** `run:fill:done` and the like, taken from the entry title `background · run:fill:done`. */
function eventName(entry: TabLogEntry): string | null {
  const at = entry.title.indexOf("run:");
  if (entry.kind !== LOG_KIND.event || at < 0) return null;
  return entry.title.slice(at + 4);
}

function fillSummary(ok: number, failed: number): string {
  return failed > 0 ? `${ok} done, ${failed} did not work` : `${ok} done`;
}

type NewItem = Omit<ActivityItem, "id" | "t" | "entryIds" | "runId" | "page">;

/** Builds the items entry by entry; each kind of entry has its own small method. */
class FeedBuilder {
  readonly items: ActivityItem[] = [];
  private readonly open = new Map<string, ActivityItem>();
  private fill: { item: ActivityItem; ok: number; failed: number } | null = null;
  private dropdowns: { item: ActivityItem; count: number } | null = null;
  private mail: { item: ActivityItem; looks: number } | null = null;
  private recommend: ActivityItem | null = null;
  private lastClick: ActivityItem | null = null;

  private add(entry: TabLogEntry, item: NewItem): ActivityItem {
    const created: ActivityItem = {
      ...item,
      id: entry.id,
      t: entry.t,
      runId: entry.runId,
      page: entry.page,
      entryIds: [entry.id],
    };
    this.items.push(created);
    return created;
  }

  handle(entry: TabLogEntry): void {
    if (entry.kind === LOG_KIND.api && entry.group) return this.api(entry, entry.group);
    if (entry.kind === LOG_KIND.error) return this.error(entry);
    if (entry.kind === LOG_KIND.dom) return this.dom(entry);
    if (entry.kind === LOG_KIND.analysis) return this.analysis(entry);
    if (entry.kind === LOG_KIND.decision) return this.decision(entry);
    const name = eventName(entry);
    if (name) return this.event(entry, name);
    if (entry.kind !== LOG_KIND.event) return;
    if (entry.title.endsWith("step:result")) this.step(entry);
    else if (entry.title.endsWith("leftover:filled")) this.dropdown(entry);
  }

  /** A backend call: one item that runs, then answers; files are told on their own. */
  private api(entry: TabLogEntry, group: string): void {
    const route = group.replace(/#\d+$/, "");
    if (route.startsWith("file")) return this.file(entry);
    if (entry.title.startsWith("→")) {
      const call = describeCall(route, {});
      this.open.set(
        group,
        this.add(entry, { title: call.running, status: "running", icon: call.icon }),
      );
      return;
    }
    if (!entry.title.startsWith("←")) return;
    const data = dataOf(entry);
    const body = (data.body && typeof data.body === "object" ? data.body : {}) as Data;
    const call = describeCall(route, body);
    const status = num(data.status);
    const refused = status != null && status >= 400;
    const finished: NewItem = {
      title: refused ? `${call.done} — refused (${status})` : call.done,
      summary: refused ? (str(body.error) ?? str(body.message) ?? call.summary) : call.summary,
      status: refused ? "warn" : "ok",
      ms: entry.ms,
      icon: call.icon,
    };
    const item = this.open.get(group);
    if (item) {
      Object.assign(item, finished);
      item.entryIds.push(entry.id);
    } else {
      this.add(entry, finished);
    }
    this.open.delete(group);
  }

  private file(entry: TabLogEntry): void {
    const name =
      String(dataOf(entry).file ?? "")
        .split("/")
        .at(-2) ?? "file";
    const title = entry.title.includes("unchanged")
      ? "Loaded the file from this computer (unchanged)"
      : entry.title.includes("downloaded")
        ? "Downloaded the file"
        : "Loaded a file";
    this.add(entry, { title, summary: name, status: statusOf(entry), ms: entry.ms, icon: "file" });
  }

  /** A caught failure: the end of a call that got no answer, or a problem of its own. */
  private error(entry: TabLogEntry): void {
    const data = dataOf(entry);
    const item = entry.group ? this.open.get(entry.group) : undefined;
    if (!item) {
      this.add(entry, {
        title: entry.title,
        summary: str(data.message) ?? str(data.cause),
        status: "error",
        icon: "done",
      });
      return;
    }
    Object.assign(item, {
      title: `${item.title.replace(/…$/, "")} — no answer`,
      summary: str(data.cause),
      status: "error",
      ms: entry.ms,
    });
    item.entryIds.push(entry.id);
    this.open.delete(entry.group ?? "");
  }

  private dom(entry: TabLogEntry): void {
    const data = dataOf(entry);
    const nodes = num(data.nodes);
    this.add(entry, {
      title: nodes != null ? `Read the page · ${nodes} elements` : "Read the page",
      summary: str(data.title),
      status: "ok",
      icon: "read",
    });
  }

  private analysis(entry: TabLogEntry): void {
    const fields = /(\d+) fields/.exec(entry.title)?.[1];
    this.add(entry, {
      title: fields ? `Found ${fields} fields to fill` : "Looked for fields",
      status: "ok",
      icon: "read",
    });
  }

  private decision(entry: TabLogEntry): void {
    const data = dataOf(entry);
    const what = str(data.what) ?? entry.title;
    // A click is already told by the click itself.
    if (what.startsWith("Click ")) return;
    const status = statusOf(entry);
    this.add(entry, {
      title: what,
      summary: str(data.why),
      status: status === "ok" ? "info" : status,
      icon: what.toLowerCase().includes("wait") ? "wait" : "done",
    });
  }

  private event(entry: TabLogEntry, name: string): void {
    const data = dataOf(entry);
    switch (name) {
      case "run:start":
        this.add(entry, { title: "Run started", status: "info", icon: "done" });
        break;
      case "page":
        this.add(entry, {
          title: `Page ${num(data.page) ?? ""}`.trim(),
          summary: str(data.url),
          status: "info",
          icon: "read",
        });
        break;
      case "recommend:start":
        this.recommend = this.add(entry, {
          title: "Choosing the best résumé…",
          status: "running",
          icon: "ai",
        });
        break;
      case "recommend:done":
      case "recommend:skipped":
      case "recommend:failed":
        this.recommendEnd(entry, name, data);
        break;
      case "click":
        this.click(entry, data);
        break;
      case "settled":
        this.settled(entry, data);
        break;
      case "tab:adopted":
      case "tab:followed":
        this.add(entry, { title: "Continued in the new tab", status: "info", icon: "tab" });
        break;
      case "fill:done":
        this.fillDone(entry, data);
        break;
      case "mail:look":
        this.mailLook(entry, data);
        break;
      case "mail:code-entered":
        this.add(entry, { title: "Entered the code from your email", status: "ok", icon: "mail" });
        break;
      case "mail:link-opened":
        this.add(entry, { title: "Opened the link from your email", status: "ok", icon: "mail" });
        break;
      case "verify:choose-email":
        this.add(entry, {
          title: "Chose email as where to send the code",
          status: "ok",
          icon: "mail",
        });
        break;
      case "run:end":
        this.runEnd(entry, data);
        break;
      default:
        // Anything the run flagged as a problem is shown; the rest is detail for the Logs tab.
        if (entry.level === "warn" || entry.level === "error") {
          this.add(entry, {
            title: name.replace(/[:_-]+/g, " "),
            summary: str(data.error) ?? str(data.text) ?? str(data.notes),
            status: statusOf(entry),
            icon: "done",
          });
        }
    }
  }

  private recommendEnd(entry: TabLogEntry, name: string, data: Data): void {
    const done: Pick<ActivityItem, "title" | "status"> = {
      title:
        name === "recommend:done"
          ? `Chose the résumé: ${str(data.stack) ?? "one from your Library"}`
          : name === "recommend:skipped"
            ? "Used the résumé already chosen for this job"
            : "Could not choose a résumé",
      status: name === "recommend:failed" ? "error" : "ok",
    };
    if (!this.recommend) {
      this.add(entry, { ...done, icon: "ai" });
      return;
    }
    Object.assign(this.recommend, done);
    this.recommend.ms = entry.t - this.recommend.t;
    this.recommend.entryIds.push(entry.id);
    this.recommend = null;
  }

  private click(entry: TabLogEntry, data: Data): void {
    const ok = data.ok !== false;
    this.lastClick = this.add(entry, {
      title: `${ok ? "Clicked" : "Could not click"} "${str(data.text) ?? "a control"}"`,
      summary: str(data.error),
      status: ok ? "ok" : "warn",
      icon: "click",
    });
  }

  private settled(entry: TabLogEntry, data: Data): void {
    const how = str(data.how);
    if (!this.lastClick || !how) return;
    this.lastClick.summary = SETTLED_TEXT[how] ?? how;
    this.lastClick.entryIds.push(entry.id);
  }

  private fillDone(entry: TabLogEntry, data: Data): void {
    const ok = data.ok !== false;
    const finished: NewItem = {
      title: ok ? "Filled the form" : "Could not fill the form",
      summary:
        str(data.message) ?? (this.fill ? fillSummary(this.fill.ok, this.fill.failed) : undefined),
      status: ok ? "ok" : "error",
      ms: num(data.durationMs),
      icon: "fill",
    };
    if (this.fill) {
      Object.assign(this.fill.item, finished);
      this.fill.item.entryIds.push(entry.id);
    } else {
      this.add(entry, finished);
    }
    this.fill = null;
    this.dropdowns = null;
  }

  private mailLook(entry: TabLogEntry, data: Data): void {
    const status = str(data.status);
    if (this.mail) {
      this.mail.looks += 1;
      this.mail.item.title = `Checked your Gmail (${this.mail.looks} times)`;
      this.mail.item.summary = status;
      this.mail.item.entryIds.push(entry.id);
    } else {
      this.mail = {
        item: this.add(entry, {
          title: "Checked your Gmail for the site's email",
          summary: status,
          status: "running",
          icon: "mail",
        }),
        looks: 1,
      };
    }
    if (status === "found") {
      this.mail.item.status = "ok";
      this.mail.item.title = "Found the site's email";
      this.mail = null;
    }
  }

  private runEnd(entry: TabLogEntry, data: Data): void {
    const outcome = str(data.outcome) ?? "ended";
    const seconds = num(data.seconds);
    this.add(entry, {
      title: RUN_END_TITLE[outcome] ?? `Run ${outcome}`,
      summary: str(data.detail) ?? str(data.reason),
      status: outcome === "failed" ? "error" : outcome === "completed" ? "ok" : "info",
      ms: seconds != null ? Math.round(seconds * 1000) : undefined,
      icon: "done",
    });
  }

  /** Step results fold into one "Filling the form" item. */
  private step(entry: TabLogEntry): void {
    if (!this.fill) {
      this.fill = {
        item: this.add(entry, { title: "Filling the form…", status: "running", icon: "fill" }),
        ok: 0,
        failed: 0,
      };
    } else {
      this.fill.item.entryIds.push(entry.id);
    }
    if (dataOf(entry).ok !== false) this.fill.ok += 1;
    else this.fill.failed += 1;
    this.fill.item.summary = fillSummary(this.fill.ok, this.fill.failed);
  }

  /** Dropdown answers fold into one item. */
  private dropdown(entry: TabLogEntry): void {
    if (!this.dropdowns) {
      this.dropdowns = {
        item: this.add(entry, { title: "Answered 1 dropdown", status: "ok", icon: "fill" }),
        count: 1,
      };
      return;
    }
    this.dropdowns.count += 1;
    this.dropdowns.item.title = `Answered ${this.dropdowns.count} dropdowns`;
    this.dropdowns.item.entryIds.push(entry.id);
  }

  /** What is still going: only while the log is fresh, and a request that never answered is lost. */
  settleRunning(entries: readonly TabLogEntry[], now: number): void {
    const fresh = entries.length > 0 && now - entries[entries.length - 1].t < STALE_AFTER_MS;
    for (const item of this.items) {
      if (item.status !== "running") continue;
      if (now - item.t > REQUEST_LOST_AFTER_MS) {
        item.status = "warn";
        item.title = `${item.title.replace(/…$/, "")} — no answer logged`;
      } else if (!fresh && item.title.startsWith("Filling")) {
        item.status = "ok";
        item.title = "Filled the form";
      } else if (!fresh) {
        item.status = "info";
      }
    }
  }
}

const SETTLED_TEXT: Record<string, string> = {
  "new-tab": "The page opened a new tab",
  navigated: "The page went to a new address",
  changed: "The page changed",
  unchanged: "The page did not change",
};

export function buildActivityFeed(
  entries: readonly TabLogEntry[],
  now = Date.now(),
): ActivityItem[] {
  const builder = new FeedBuilder();
  for (const entry of entries) builder.handle(entry);
  builder.settleRunning(entries, now);
  return builder.items;
}

/** The latest run's items, or every item when the log holds no run. */
export function latestRunItems(items: readonly ActivityItem[]): ActivityItem[] {
  const last = [...items].reverse().find((item) => item.runId)?.runId;
  if (!last) return [...items];
  return items.filter((item) => item.runId === last);
}
