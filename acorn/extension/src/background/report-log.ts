import { summarizeLog } from "../log-summary";
import { isAgentImage } from "../sidebar/agent-files";
import { flushTabLogs, getTabLog } from "../tab-log-session";

/** What a support report carries of the tab's log: the summary, then every entry whole. */
async function reportLogJson(tabId: number): Promise<string> {
  await flushTabLogs();
  // The Agent Run's screenshots stay on the device (the download has them): a report would be very large.
  const entries = (await getTabLog(tabId)).filter((entry) => !isAgentImage(entry));
  const summary = summarizeLog(entries, import.meta.env.VITE_ACORN_VERSION ?? "");
  return JSON.stringify({ summary, entries });
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * The tab's local log, gzipped and base64-encoded, for the one request that sends it:
 * the person submitting a report. Null when the tab has no log.
 */
export async function reportLogGzipBase64(tabId: number): Promise<string | null> {
  const json = await reportLogJson(tabId);
  if (!json || json.length < 3) return null;
  const packed = await gzip(json);
  return packed.length ? toBase64(packed) : null;
}
