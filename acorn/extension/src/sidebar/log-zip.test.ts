import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inflateRawSync } from "node:zlib";

import { buildLogZip, buildZip } from "./log-zip.ts";

import type { TabLogEntry } from "../tab-log-session.ts";

const METHOD_DEFLATE = 8;
const SIG_CENTRAL = 0x02014b50;

type Row = { name: string; method: number; packed: number; size: number; data: Uint8Array };

/** Reads a zip's central directory back, the way an unzip tool would. */
async function readZip(blob: Blob): Promise<Row[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const count = view.getUint16(bytes.length - 22 + 10, true);
  let at = view.getUint32(bytes.length - 22 + 16, true);
  const rows: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(view.getUint32(at, true), SIG_CENTRAL);
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const stored = bytes.subarray(start, start + packed);
    const data = method === METHOD_DEFLATE ? new Uint8Array(inflateRawSync(stored)) : stored;
    rows.push({ name, method, packed, size, data });
    at += 46 + nameLength;
  }
  return rows;
}

describe("buildZip", () => {
  it("deflates text so the download is much smaller, and unpacks to the same bytes", async () => {
    const text = JSON.stringify({
      line: "the page said the same thing again and again ".repeat(400),
    });
    const data = new TextEncoder().encode(text);
    const [row] = await readZip(
      await buildZip([{ name: "a.json", data, modified: new Date(2026, 9, 14) }]),
    );
    assert.equal(row.method, METHOD_DEFLATE);
    assert.ok(row.packed < data.length / 5, `packed ${row.packed} of ${data.length}`);
    assert.equal(row.size, data.length);
    assert.equal(new TextDecoder().decode(row.data), text);
  });

  it("stores a file that does not shrink", async () => {
    const data = new Uint8Array([1]);
    const [row] = await readZip(await buildZip([{ name: "b.bin", data, modified: new Date() }]));
    assert.equal(row.method, 0);
    assert.deepEqual([...row.data], [1]);
  });
});

describe("buildLogZip", () => {
  it("opens with the summary and index, then holds every entry", async () => {
    const entries: TabLogEntry[] = [1, 2, 3].map((n) => ({
      id: `e${n}`,
      t: 1_000 * n,
      kind: "event",
      title: `background · run:step-${n}`,
      text: JSON.stringify({ n }),
    }));
    const rows = await readZip(await buildLogZip(entries));
    assert.equal(rows.length, 5);
    assert.equal(rows[0].name, "00-summary.json");
    assert.equal(rows[1].name, "01-index.json");
    assert.deepEqual(
      rows.slice(2).map((row) => JSON.parse(new TextDecoder().decode(row.data))),
      [{ n: 1 }, { n: 2 }, { n: 3 }],
    );
  });
});
