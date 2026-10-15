/**
 * Puts a résumé into a page's file input without the operating system's file dialog. The
 * debugger intercepts the picker the click would open, and the file is set on the input
 * it was for; a control that takes the file without opening a picker (a drop zone with an
 * input behind it) is found from the point that was clicked.
 */

import { clickAt } from "./input";

import type { Cdp } from "./cdp";

/** How long to wait for the click to open a file picker before looking for the input itself. */
export const FILE_CHOOSER_WAIT_MS = 2_000;

/** A file the run fetched from the agent server. */
export interface ResumeFile {
  fileName: string;
  contentType: string;
  /** The file's bytes, base64. */
  base64: string;
}

/** What setting the file did, for the log and for the model. */
export interface UploadResult {
  fileName: string;
  bytes: number;
  via: "picker" | "input";
}

/** Runs in the page, on the file input: wraps the bytes in a File, sets it, and tells the page. */
const SET_FILE_FUNCTION = `function (name, type, base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], name, { type }));
  this.files = transfer.files;
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return { name: this.files.length ? this.files[0].name : "", size: this.files.length ? this.files[0].size : 0 };
}`;

/** Finds the file input a point belongs to: the element, its label's control, or one near it. */
function findInputScript(x: number, y: number): string {
  return `(() => {
    const isFile = (el) => el && el.tagName === "INPUT" && el.type === "file";
    let el = document.elementFromPoint(${x}, ${y});
    if (!el) return null;
    if (isFile(el)) return el;
    if (el.closest("label") && isFile(el.closest("label").control)) return el.closest("label").control;
    for (let node = el, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
      const input = node.querySelector && node.querySelector('input[type="file"]');
      if (input) return input;
    }
    return null;
  })()`;
}

type ResolvedNode = { object: { objectId?: string } };
type EvaluateObject = { result?: { objectId?: string; subtype?: string } };
type CallResult = {
  result?: { value?: { name?: string; size?: number } };
  exceptionDetails?: { text?: string };
};

async function setOnObject(
  cdp: Cdp,
  objectId: string,
  file: ResumeFile,
): Promise<{ name: string; size: number }> {
  const answer = await cdp.send<CallResult>("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: SET_FILE_FUNCTION,
    arguments: [{ value: file.fileName }, { value: file.contentType }, { value: file.base64 }],
    returnByValue: true,
  });
  if (answer.exceptionDetails)
    throw new Error(answer.exceptionDetails.text ?? "the page refused the file");
  const value = answer.result?.value;
  if (!value?.name) throw new Error("the page did not take the file");
  return { name: value.name, size: value.size ?? 0 };
}

/**
 * Clicks at a point (CSS pixels) and puts the file in the input that click is for. The
 * session must already have asked the browser to hand it file pickers
 * (Page.setInterceptFileChooserDialog); otherwise the click opens the system dialog.
 */
export async function uploadAt(
  cdp: Cdp,
  x: number,
  y: number,
  file: ResumeFile,
  chooserWaitMs = FILE_CHOOSER_WAIT_MS,
): Promise<UploadResult> {
  let opened: ((backendNodeId: number) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const chooser = new Promise<number | null>((resolve) => {
    opened = (id) => resolve(id);
    timer = setTimeout(() => resolve(null), chooserWaitMs);
  });
  const stopListening = cdp.onEvent((method, params) => {
    if (method === "Page.fileChooserOpened" && typeof params.backendNodeId === "number")
      opened?.(params.backendNodeId);
  });
  try {
    await clickAt(cdp, x, y);
    const backendNodeId = await chooser;
    clearTimeout(timer);
    if (backendNodeId != null) {
      const node = await cdp.send<ResolvedNode>("DOM.resolveNode", { backendNodeId });
      if (!node.object.objectId) throw new Error("the page's file input could not be reached");
      const set = await setOnObject(cdp, node.object.objectId, file);
      return { fileName: set.name, bytes: set.size, via: "picker" };
    }
    const found = await cdp.send<EvaluateObject>("Runtime.evaluate", {
      expression: findInputScript(x, y),
    });
    const objectId = found.result?.objectId;
    if (!objectId || found.result?.subtype === "null") {
      throw new Error("the click opened no file picker and no file input is there");
    }
    const set = await setOnObject(cdp, objectId, file);
    return { fileName: set.name, bytes: set.size, via: "input" };
  } finally {
    stopListening();
  }
}

/** Base64 of bytes, in pieces: one call on a large file overflows the argument limit. */
export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const piece = 0x8000;
  let binary = "";
  for (let i = 0; i < view.length; i += piece) {
    binary += String.fromCharCode(...view.subarray(i, i + piece));
  }
  return btoa(binary);
}
