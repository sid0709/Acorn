/** How the files of an Agent Run's trace are named, the same in the log and in the zip. */

/** The run's timeline: one line per entry, appended as the entries come. */
export const TIMELINE_FILE = "timeline.txt";
/** The folder of the zip that holds the Agent Runs. */
export const AGENT_ZIP_FOLDER = "agent";

/** An entry's number as the server numbers its files: 001, 002, … */
export function entryName(seq: number): string {
  return String(seq).padStart(3, "0");
}

/** Whether a trace file is a picture (its content is base64). */
export function isImageName(name: string): boolean {
  return /\.(jpe?g|png)$/i.test(name);
}

/** The extension and base64 of a data URL, or null when it is not an image data URL. */
export function splitImageDataUrl(dataUrl: string): { ext: string; base64: string } | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/") || comma < 0) return null;
  const mime = dataUrl.slice("data:image/".length, dataUrl.indexOf(";"));
  return { ext: mime === "png" ? "png" : "jpg", base64: dataUrl.slice(comma + 1) };
}
