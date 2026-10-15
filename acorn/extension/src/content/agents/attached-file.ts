import { fieldWrapper } from "../form-dom";
import { isA } from "../realm";

import type { RuntimeAttachedFile } from "../../types";

/** Every name the run could attach for this file: the file and each of its other formats. */
function fileNames(file: RuntimeAttachedFile): string[] {
  return [file, ...(file.variants ?? [])]
    .map((version) => version.name.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether an upload field already holds this very file: its input carries it, or
 * the field shows its name (a page that took the upload often redraws itself with
 * the attached file named beside an empty input). Only the file's own names count,
 * never the page's wording, so another file the field holds is still replaced.
 */
export function fieldHoldsFile(
  control: Element,
  file: RuntimeAttachedFile | null | undefined,
): boolean {
  if (!file) return false;
  const names = fileNames(file);
  if (!names.length) return false;
  if (isA(control, HTMLInputElement) && control.type === "file") {
    const held = Array.from(control.files ?? []).map((attached) => attached.name.toLowerCase());
    if (held.some((name) => names.includes(name))) return true;
  }
  const wrapper = fieldWrapper(control);
  const shown = ((wrapper as HTMLElement).innerText ?? wrapper.textContent ?? "").toLowerCase();
  return names.some((name) => shown.includes(name));
}
