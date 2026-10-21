import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  blobRef,
  imageHash,
  imageHashes,
  isBlobRef,
  packImages,
  packableObservation,
  packableShot,
} from "../../src/agent/image-refs.ts";

import type { AgentObservation } from "@acorn/shared/agent-contract";

const A = "data:image/jpeg;base64,AAAA";
const B = "data:image/jpeg;base64,BBBB";
const C = "data:image/jpeg;base64,CCCC";

function look(): AgentObservation {
  return {
    screenshot: A,
    url: "https://jobs.example",
    title: "Apply",
    viewport: {
      width: 1280,
      height: 800,
      scrollX: 0,
      scrollY: 0,
      pageWidth: 1280,
      pageHeight: 3000,
    },
    survey: [
      { screenshot: A, scrollY: 0 },
      { screenshot: B, scrollY: 800 },
    ],
    zoneShots: [{ zone: 2, screenshot: C, scrollY: 800 }],
  };
}

describe("image references", () => {
  it("names a picture by the SHA-256 of its data URL, as the server does", async () => {
    const want = createHash("sha256").update(A).digest("hex");
    assert.equal(await imageHash(A), want);
    assert.equal(blobRef(want), `ref:sha256:${want}`);
    assert.ok(isBlobRef(blobRef(want)));
    assert.ok(!isBlobRef(A));
  });

  it("sends a held picture as a reference and a repeated one once, leaving the original alone", async () => {
    const original = look();
    const packable = packableObservation(original);
    const hashes = await imageHashes(packable);
    assert.equal(hashes.length, 4);
    const packed = packImages(packable, hashes, new Set([hashes[2]]));
    // The screenshot goes as bytes; the first survey screen is the same picture, so it is a reference;
    // the second was held by the server; the zone photo is new.
    assert.equal(packed.body.screenshot, A);
    assert.equal(packed.body.survey?.[0]?.screenshot, blobRef(hashes[0]));
    assert.equal(packed.body.survey?.[1]?.screenshot, blobRef(hashes[2]));
    assert.equal(packed.body.zoneShots?.[0]?.screenshot, C);
    assert.deepEqual(packed.inlined, [hashes[0], hashes[3]]);
    assert.equal(packed.refs, 2);
    // What the run holds in memory is untouched.
    assert.equal(original.survey?.[0]?.screenshot, A);
    assert.equal(original.survey?.[1]?.screenshot, B);
  });

  it("swaps nothing when references are not allowed", async () => {
    const packable = packableObservation(look());
    const hashes = await imageHashes(packable);
    const packed = packImages(packable, hashes, new Set(hashes), false);
    assert.equal(packed.refs, 0);
    assert.deepEqual(packed.inlined, hashes);
    assert.equal(packed.body.survey?.[0]?.screenshot, A);
  });

  it("packs a picture sent mid-batch the same way", async () => {
    const upload = { kind: "zone" as const, zone: 1, screenshot: B, scrollY: 0 };
    const packable = packableShot(upload);
    const hashes = await imageHashes(packable);
    const packed = packImages(packable, hashes, new Set(hashes));
    assert.equal(packed.body.screenshot, blobRef(hashes[0]));
    assert.equal(upload.screenshot, B);
  });
});
