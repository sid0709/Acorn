/**
 * The agent server keeps every picture a run sends, by hash, for the rest of the run. A picture the server
 * already holds (a survey screen reused from the last survey, a zone photo posted mid-batch and sent again
 * with the look after, the look's own screenshot that is also a screen of its survey) goes as a reference,
 * "ref:sha256:<hex>", instead of its bytes. The server swaps the reference back before the agent sees the
 * request, so the agent is given exactly what it would have been given: the same data URLs, in the same
 * fields. Only the request body is packed this way; the run's own objects keep their data URLs.
 */

import {
  AGENT_BLOB_REF_PREFIX,
  type AgentObservation,
  type AgentShotUpload,
} from "@acorn/shared/agent-contract";

const encoder = new TextEncoder();

/** How a picture is named: the SHA-256 of its data URL as hex, which the server computes the same way. */
export async function imageHash(dataUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(dataUrl));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The reference to a picture with this hash. */
export function blobRef(hash: string): string {
  return `${AGENT_BLOB_REF_PREFIX}${hash}`;
}

/** Whether a picture field holds a reference instead of a data URL. */
export function isBlobRef(value: string): boolean {
  return value.startsWith(AGENT_BLOB_REF_PREFIX);
}

/** One picture field of a payload copy: where it is read and written. */
export interface ImageSlot {
  get(): string;
  set(value: string): void;
}

/** A copy of a payload with its picture fields reachable, so they can be swapped without touching the original. */
export interface Packable<T> {
  body: T;
  slots: ImageSlot[];
}

/** A look, copied: its screenshot, each survey screen, each zone photo. */
export function packableObservation(observation: AgentObservation): Packable<AgentObservation> {
  const body: AgentObservation = {
    ...observation,
    ...(observation.survey ? { survey: observation.survey.map((screen) => ({ ...screen })) } : {}),
    ...(observation.zoneShots
      ? { zoneShots: observation.zoneShots.map((zone) => ({ ...zone })) }
      : {}),
  };
  const slots: ImageSlot[] = [
    { get: () => body.screenshot, set: (value) => (body.screenshot = value) },
  ];
  for (const screen of body.survey ?? []) {
    slots.push({ get: () => screen.screenshot, set: (value) => (screen.screenshot = value) });
  }
  for (const zone of body.zoneShots ?? []) {
    slots.push({ get: () => zone.screenshot, set: (value) => (zone.screenshot = value) });
  }
  return { body, slots };
}

/** A picture sent mid-batch, copied. */
export function packableShot(upload: AgentShotUpload): Packable<AgentShotUpload> {
  const body: AgentShotUpload = { ...upload };
  return {
    body,
    slots: [{ get: () => body.screenshot, set: (value) => (body.screenshot = value) }],
  };
}

/** The hash of every picture of a payload, in the order of its slots. */
export function imageHashes(packable: Packable<unknown>): Promise<string[]> {
  return Promise.all(packable.slots.map((slot) => imageHash(slot.get())));
}

/** What packing did: the body to send and which pictures went as bytes (the rest went as references). */
export interface Packed<T> {
  body: T;
  inlined: string[];
  refs: number;
}

/**
 * Swaps the pictures the server holds (`held`) for references, and a picture that comes twice in one
 * payload for one copy and a reference. `hashes` are the payload's pictures' hashes (imageHashes). With
 * `useRefs` off (a server that keeps no pictures, or a last try as bytes alone) nothing is swapped. The
 * payload copy is changed in place and handed back; the original keeps its data URLs.
 */
export function packImages<T>(
  packable: Packable<T>,
  hashes: readonly string[],
  held: ReadonlySet<string>,
  useRefs = true,
): Packed<T> {
  const carried = new Set<string>();
  const inlined: string[] = [];
  let refs = 0;
  packable.slots.forEach((slot, index) => {
    const hash = hashes[index];
    if (hash == null || slot.get() === "" || isBlobRef(slot.get())) return;
    if (useRefs && (held.has(hash) || carried.has(hash))) {
      slot.set(blobRef(hash));
      refs += 1;
      return;
    }
    carried.add(hash);
    inlined.push(hash);
  });
  return { body: packable.body, inlined, refs };
}
