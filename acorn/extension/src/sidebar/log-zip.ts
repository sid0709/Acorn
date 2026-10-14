import { logIndex, summarizeLog } from "../log-summary";
import { LOG_KIND, type TabLogEntry } from "../tab-log-session";

/** A zip of the log: one file per entry, named by its time, kind and title, each compressed. */

const ZIP_MIME = "application/zip";
/** Longest title kept in a file name, so the path stays well inside any file system's limit. */
const FILE_TITLE_MAX_CHARS = 80;
/** Trees are plain text; every other entry is JSON. */
const TEXT_KINDS = new Set<string>([LOG_KIND.pureTree, LOG_KIND.metaTree]);

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const ZIP_VERSION = 20;
/** General-purpose bit 11: names and contents are UTF-8. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const DOS_YEAR_BASE = 1980;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day:
      ((Math.max(date.getFullYear(), DOS_YEAR_BASE) - DOS_YEAR_BASE) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

type ZipFile = { name: string; data: Uint8Array; modified: Date };

/** A file as it is written: its bytes, how they are packed, and the original size. */
type PackedFile = ZipFile & { packed: Uint8Array; method: number };

/** Raw deflate, the method every zip reader understands; null when the browser cannot. */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Compress each file; one that does not shrink is stored as it is. */
async function pack(files: ZipFile[]): Promise<PackedFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const compressed = await deflate(file.data);
      return compressed && compressed.length < file.data.length
        ? { ...file, packed: compressed, method: METHOD_DEFLATE }
        : { ...file, packed: file.data, method: METHOD_STORE };
    }),
  );
}

/** The zip of `files`: every file deflated (logs are text and shrink many times over). */
export async function buildZip(input: ZipFile[]): Promise<Blob> {
  const files = await pack(input);
  const encoder = new TextEncoder();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const { time, day } = dosDateTime(file.modified);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, SIG_LOCAL, true);
    local.setUint16(4, ZIP_VERSION, true);
    local.setUint16(6, FLAG_UTF8, true);
    local.setUint16(8, file.method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, file.packed.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, file.packed as Uint8Array<ArrayBuffer>);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, SIG_CENTRAL, true);
    entry.setUint16(4, ZIP_VERSION, true);
    entry.setUint16(6, ZIP_VERSION, true);
    entry.setUint16(8, FLAG_UTF8, true);
    entry.setUint16(10, file.method, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, day, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.packed.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.length + file.packed.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, SIG_END, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: ZIP_MIME });
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** `20261013-142501-123`: sorts in time order and carries the millisecond. */
export function stampOf(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

function safeTitle(title: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, FILE_TITLE_MAX_CHARS);
  return cleaned || "entry";
}

/** Every entry's file name: `<timestamp>_<title>.<ext>`; a repeat gets a numeric suffix. */
export function logFileNames(entries: TabLogEntry[]): string[] {
  const used = new Map<string, number>();
  return entries.map((entry) => {
    const base = `${stampOf(entry.t)}_${safeTitle(entry.title)}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const ext = TEXT_KINDS.has(entry.kind) ? "txt" : "json";
    return `${seen ? `${base}-${seen + 1}` : base}.${ext}`;
  });
}

/** The zip's two overview files come first, named so they sort before every entry. */
const SUMMARY_FILE = "00-summary.json";
const INDEX_FILE = "01-index.json";

export async function buildLogZip(entries: TabLogEntry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const names = logFileNames(entries);
  const now = Date.now();
  const version = import.meta.env.VITE_ACORN_VERSION ?? "";
  const overview = (name: string, value: unknown) => ({
    name,
    data: encoder.encode(JSON.stringify(value, null, 2)),
    modified: new Date(now),
  });
  return buildZip([
    overview(SUMMARY_FILE, summarizeLog(entries, version, now)),
    overview(INDEX_FILE, logIndex(entries, names)),
    ...entries.map((entry, i) => ({
      name: names[i],
      data: encoder.encode(entry.text),
      modified: new Date(entry.t),
    })),
  ]);
}

export async function downloadLogZip(entries: TabLogEntry[], tabId: number | null): Promise<void> {
  const url = URL.createObjectURL(await buildLogZip(entries));
  const a = document.createElement("a");
  a.href = url;
  a.download = `acorn-log-tab${tabId ?? "none"}-${stampOf(Date.now())}.zip`;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}
