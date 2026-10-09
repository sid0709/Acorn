import type { TextItem } from "pdfjs-dist/types/src/display/api";

/** Vertical drift, in font heights, that still counts as the same printed line. */
const SAME_LINE = 0.5;
/** A horizontal gap this many font heights wide separates columns, e.g. a title and its dates. */
const COLUMN_GAP = 1.5;
/** A gap this many font heights wide is a space the PDF did not write as text. */
const WORD_GAP = 0.15;
/** Used when a text run reports no height. */
const FALLBACK_HEIGHT = 10;

type Run = { text: string; x: number; y: number; end: number; height: number };

/**
 * Reads a PDF's text in reading order, one printed line per line, with a tab
 * where a line jumps across a column. Link targets (a "LinkedIn" label that
 * points at a profile) follow the text, since the label alone has no URL.
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" },
    );
  }
  // pdf.js transfers `data.buffer` to the worker, which empties the caller's array.
  // Upload encodes those same bytes afterward, so the worker gets a copy.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const pages: string[] = [];
  const links = new Set<string>();
  try {
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      pages.push(pageLines(content.items.filter(isTextItem)).join("\n"));
      for (const annotation of await page.getAnnotations()) {
        const url = (annotation as { url?: unknown }).url;
        if (typeof url === "string" && url) links.add(url);
      }
    }
  } finally {
    await task.destroy();
  }
  return [...pages, ...links].join("\n");
}

function isTextItem(item: object): item is TextItem {
  return "str" in item && "transform" in item;
}

function pageLines(items: TextItem[]): string[] {
  const runs: Run[] = items
    .filter((item) => item.str.trim())
    .map((item) => {
      const height =
        Math.hypot(item.transform[2], item.transform[3]) || item.height || FALLBACK_HEIGHT;
      const x = item.transform[4];
      return { text: item.str, x, y: item.transform[5], end: x + item.width, height };
    })
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: Run[][] = [];
  for (const run of runs) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0].y - run.y) <= SAME_LINE * run.height) line.push(run);
    else lines.push([run]);
  }
  return lines.map(joinLine);
}

function joinLine(line: Run[]) {
  const sorted = [...line].sort((a, b) => a.x - b.x);
  let text = "";
  let previous: Run | null = null;
  for (const run of sorted) {
    if (previous) {
      const gap = run.x - previous.end;
      if (gap > COLUMN_GAP * run.height) text += "\t";
      else if (gap > WORD_GAP * run.height && !/\s$/.test(text) && !/^\s/.test(run.text))
        text += " ";
    }
    text += run.text;
    previous = run;
  }
  return text.trim();
}
