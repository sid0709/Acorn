/**
 * What a run's requests to the agent may do to spare the person's line, and what the server holds for the
 * run: the capabilities the server offered when the run started, the hashes of the pictures it keeps
 * (image-refs.ts), the pictures on their way to it, and the lane the requests take turns on
 * (upload-lane.ts). One of these per session, from the start of the run to its end.
 */

import { AGENT_GZIP_ENCODING, type AgentTransport } from "@acorn/shared/agent-contract";

import { UploadLane } from "./upload-lane";

/** Bodies shorter than this go as they are: gzip's own header would eat the gain. */
export const GZIP_MIN_BYTES = 1024;
/**
 * The slowest line a request is given time for: 8 KB/s, a 100 kbit/s connection with room to spare. A
 * request's timeout grows by its bytes over this, so a long survey or a résumé file is not cut off where
 * the line, not the server, is slow.
 */
export const SLOW_LINK_BYTES_PER_SEC = 8 * 1024;
const MS_PER_SECOND = 1000;

/** How much longer a request of this many bytes (sent and expected back) may take on the slowest line. */
export function transferAllowanceMs(bytes: number): number {
  return Math.ceil(bytes / SLOW_LINK_BYTES_PER_SEC) * MS_PER_SECOND;
}

export interface SessionTransport {
  /** What the server offered; nothing from an older server. */
  can: AgentTransport;
  /** The hashes of the pictures the server holds for the run. */
  readonly held: Set<string>;
  /**
   * Pictures on their way to the server, by data URL: a request that would carry one waits for it to arrive
   * instead, then refers to it. A promise here settles either way and never rejects.
   */
  readonly pending: Map<string, Promise<void>>;
  readonly lane: UploadLane;
}

const sessions = new Map<string, SessionTransport>();

/** The run's transport; a run the server told nothing about sends everything as bytes. */
export function transportOf(sessionId: string): SessionTransport {
  let transport = sessions.get(sessionId);
  if (!transport) {
    transport = { can: {}, held: new Set(), pending: new Map(), lane: new UploadLane() };
    sessions.set(sessionId, transport);
  }
  return transport;
}

/** Keeps what the server offered when the run started or continued. */
export function rememberTransport(sessionId: string, can: AgentTransport | undefined): void {
  transportOf(sessionId).can = can ?? {};
}

/** The run ended: nothing is held for it any more. */
export function forgetTransport(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Packs bytes with gzip, as the server unpacks them. */
export async function gzipBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new CompressionStream(AGENT_GZIP_ENCODING);
  const packed = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await packed);
}
