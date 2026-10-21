import { TIMELINE_FILE, entryName, splitImageDataUrl } from "./trace-names";

import type { AgentSurveyScreen, AgentTrace, AgentZoneShot } from "@acorn/shared/agent-contract";

/** Where the run's trace files go: the run's log. */
type FileSink = { agentFile(name: string, content: string): void };

/** The pictures the extension took itself for one look, which the server does not send back. */
export type AgentLook = {
  seq: number;
  screenshot: string;
  survey?: AgentSurveyScreen[];
  zones?: AgentZoneShot[];
};

/**
 * Keeps what an Agent Run's server returned (its trace files and timeline line) and the screenshots
 * the extension took for that look in the run's log, so the Logs tab's Download holds the whole run.
 */
export function recordAgentTrace(
  log: FileSink,
  trace: AgentTrace | undefined,
  look?: AgentLook,
): void {
  if (look) {
    const stem = entryName(look.seq);
    const shot = splitImageDataUrl(look.screenshot);
    if (shot) log.agentFile(`${stem}.${shot.ext}`, shot.base64);
    look.survey?.forEach((screen, index) => {
      const part = splitImageDataUrl(screen.screenshot);
      if (part) log.agentFile(`${stem}.survey${index + 1}.${part.ext}`, part.base64);
    });
    look.zones?.forEach((zone) => {
      const part = splitImageDataUrl(zone.screenshot);
      if (part) log.agentFile(`${stem}.zone${zone.zone}.${part.ext}`, part.base64);
    });
  }
  if (!trace) return;
  for (const file of trace.files) log.agentFile(file.name, file.data ?? file.text ?? "");
  if (trace.timeline) log.agentFile(TIMELINE_FILE, trace.timeline);
}
