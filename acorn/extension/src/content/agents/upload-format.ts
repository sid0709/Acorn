/**
 * Which version of a Library file an upload field gets. A stack can hold the same
 * résumé or cover letter as PDF and as Word; the field's own accept list, then the
 * format the plan read from its words, decides which one goes in. A field that
 * takes only one format never gets another.
 */

import type { RuntimeAttachedFile } from "../../types";

/** Formats the plan can ask an upload for (see the planner's upload format). */
const WANTED_FORMATS: Record<string, readonly string[]> = {
  pdf: ["pdf"],
  word: ["docx", "doc"],
};

/** The media types each file format is sent as. */
const FORMAT_MEDIA_TYPES: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  doc: ["application/msword"],
  txt: ["text/plain"],
};

/** A file's format: what the Library says, else its extension. */
function formatOf(file: RuntimeAttachedFile): string {
  const named = String(file.format || "")
    .trim()
    .toLowerCase();
  if (named) return named;
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
}

/** The input's accept list, as lowercase tokens (".pdf", "application/pdf", "image/*"). */
function acceptTokens(input: HTMLInputElement): string[] {
  return (input.accept || "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether one accept token lets this file in: by extension, media type, or wildcard. */
function tokenAccepts(token: string, file: RuntimeAttachedFile): boolean {
  const format = formatOf(file);
  if (token.startsWith(".")) return token === `.${format}`;
  const types = new Set([
    String(file.mimeType || "").toLowerCase(),
    ...(FORMAT_MEDIA_TYPES[format] ?? []),
  ]);
  if (token === "*/*") return true;
  if (token.endsWith("/*")) {
    const family = token.slice(0, -1);
    return [...types].some((type) => type.startsWith(family));
  }
  return types.has(token);
}

function describeFile(file: RuntimeAttachedFile): string {
  const what = file.kind === "cover_letter" ? "cover letter" : "résumé";
  const stack = String(file.label || "").trim();
  return stack ? `the ${stack} ${what}` : `the ${what}`;
}

/**
 * The version of `file` to put in `input`: one the input accepts, in the format
 * the plan asked for when it asked, preferred format first. Throws when the stack
 * has no version the field takes, naming what to add to the Library.
 */
export function chooseUploadFile(
  input: HTMLInputElement,
  file: RuntimeAttachedFile,
  wanted?: string | null,
): RuntimeAttachedFile {
  const versions = [file, ...(file.variants ?? [])];
  const tokens = acceptTokens(input);
  const accepted = tokens.length
    ? versions.filter((version) => tokens.some((token) => tokenAccepts(token, version)))
    : versions;
  if (!accepted.length) {
    throw new Error(
      `This upload takes ${input.accept}, and ${describeFile(file)} has no file of that type in your Library`,
    );
  }
  const formats = WANTED_FORMATS[String(wanted || "").toLowerCase()];
  if (!formats) return accepted[0];
  const matching = accepted.filter((version) => formats.includes(formatOf(version)));
  if (!matching.length) {
    const named = String(wanted).toLowerCase() === "pdf" ? "a PDF" : "a Word document";
    throw new Error(
      `This upload takes only ${named}, and ${describeFile(file)} has none in your Library`,
    );
  }
  return matching[0];
}
