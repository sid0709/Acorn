/**
 * What the extension asks of a frame's content script for the quick text pass, and what it answers.
 * The content script ([`content/prefill-bridge.ts`](../../content/prefill-bridge.ts)) reads and measures
 * the page; the service worker decides and acts.
 */

import type { DomNode } from "./dom-types";
import type { TreeScan } from "./scan";

export const PREFILL_MESSAGE = {
  /** Serialize this frame's DOM and say which plain fields are still empty in it. */
  scan: "acorn:prefill-scan",
  /** What is left on this frame's page: required fields still empty, and error messages showing. */
  review: "acorn:prefill-review",
  /** The controls of this frame's page that could be pressed, numbered by the serializer. */
  candidates: "acorn:prefill-candidates",
  /** Serialize this frame's DOM and send it. */
  serialize: "acorn:prefill-serialize",
  /** What an element is: its kind, whether it is empty, its options or its group. */
  describe: "acorn:prefill-describe",
  /** Scroll an element to the middle of the frame. */
  reveal: "acorn:prefill-reveal",
  /** Where an element is, in this frame's own viewport. */
  locate: "acorn:prefill-locate",
  /** What an element holds now. */
  read: "acorn:prefill-read",
  /** Listen for a child frame's probe (below). */
  armProbe: "acorn:prefill-arm-probe",
  /** A child frame announces itself to its parent. */
  sendProbe: "acorn:prefill-send-probe",
  /** Where the frame that sent the probe sits in this frame. */
  readProbe: "acorn:prefill-read-probe",
} as const;

export type PrefillMessageType = (typeof PREFILL_MESSAGE)[keyof typeof PREFILL_MESSAGE];

/** What one frame's page says of itself (the review's findings, before the pass's failures are added). */
export type FrameReview =
  | { ok: true; fields: number; empty: string[]; errors: string[]; blocked: string[] }
  | { ok: false; error: string };

export interface FrameCandidate {
  nodeId: number;
  text: string;
  kind: "button" | "submit";
  inForm: boolean;
}

export type FrameCandidates =
  { ok: true; candidates: FrameCandidate[] } | { ok: false; error: string };

export type ScannedFrame = ({ ok: true } & TreeScan) | { ok: false; error: string };

export type SerializedFrame =
  { ok: true; url: string; title: string; tree: DomNode } | { ok: false; error: string };

/** What kind of control an element is, as far as the quick pass can drive it. */
export type ControlKind = "text" | "select" | "radio" | "checkbox" | "other";

export interface GroupMember {
  nodeId: number;
  label: string;
  checked: boolean;
}

export type Described =
  | {
      ok: true;
      kind: ControlKind;
      /** Nothing in it yet: a text box with no text, a list on its prompt, a group with nothing chosen. */
      empty: boolean;
      /** The question around the element, for the check on who the applicant is. */
      question: string;
      /** A native list's options. */
      options: string[];
      /** A radio group's members, or the checkbox itself. */
      members: GroupMember[];
      maxLength: number;
    }
  | { ok: false; error: string };

export type Located = { ok: true; x: number; y: number } | { ok: false; error: string };

export type ReadBack =
  { ok: true; value: string; checked: boolean; selected: string } | { ok: false; error: string };

export type ProbeRead = { ok: true; found: boolean; x: number; y: number } | { ok: false };

export type PrefillRequestMessage =
  | { type: typeof PREFILL_MESSAGE.scan }
  | { type: typeof PREFILL_MESSAGE.review }
  | { type: typeof PREFILL_MESSAGE.candidates }
  | { type: typeof PREFILL_MESSAGE.serialize }
  | { type: typeof PREFILL_MESSAGE.describe; nodeId: number }
  | { type: typeof PREFILL_MESSAGE.reveal; nodeId: number }
  | { type: typeof PREFILL_MESSAGE.locate; nodeId: number }
  | { type: typeof PREFILL_MESSAGE.read; nodeId: number }
  | { type: typeof PREFILL_MESSAGE.armProbe; token: string }
  | { type: typeof PREFILL_MESSAGE.sendProbe; token: string }
  | { type: typeof PREFILL_MESSAGE.readProbe; token: string };
