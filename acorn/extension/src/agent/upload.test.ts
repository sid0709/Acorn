import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeCdp } from "./fake-cdp.ts";
import { toBase64, uploadAt } from "./upload.ts";

const file = { fileName: "Ada.pdf", contentType: "application/pdf", base64: "QUJD" };

describe("uploadAt", () => {
  it("sets the file on the input the page's own picker was for", async () => {
    const cdp = fakeCdp({
      "DOM.resolveNode": { object: { objectId: "node-7" } },
      "Runtime.callFunctionOn": { result: { value: { name: "Ada.pdf", size: 3 } } },
    });
    // The click opens a picker: the browser reports it while the click is being sent.
    const click = cdp.send.bind(cdp);
    cdp.send = async (method, params) => {
      const result = await click(method, params);
      if (
        method === "Input.dispatchMouseEvent" &&
        params &&
        (params as { type: string }).type === "mouseReleased"
      ) {
        cdp.emit("Page.fileChooserOpened", { backendNodeId: 7 });
      }
      return result as never;
    };
    const done = await uploadAt(cdp, 10, 20, file);
    assert.deepEqual(done, { fileName: "Ada.pdf", bytes: 3, via: "picker" });
    assert.deepEqual(cdp.of("DOM.resolveNode")[0].params, { backendNodeId: 7 });
    const call = cdp.of("Runtime.callFunctionOn")[0].params as {
      objectId: string;
      arguments: { value: string }[];
    };
    assert.equal(call.objectId, "node-7");
    assert.deepEqual(
      call.arguments.map((a) => a.value),
      ["Ada.pdf", "application/pdf", "QUJD"],
    );
  });

  it("falls back to the file input at the point when no picker opens", async () => {
    const cdp = fakeCdp({
      "Runtime.evaluate": { result: { objectId: "input-1" } },
      "Runtime.callFunctionOn": { result: { value: { name: "Ada.pdf", size: 3 } } },
    });
    const done = await uploadAt(cdp, 10, 20, file, 5);
    assert.equal(done.via, "input");
    assert.match(
      String(cdp.of("Runtime.evaluate")[0].params?.expression),
      /elementFromPoint\(10, 20\)/,
    );
  });

  it("says so when there is nowhere to put the file", async () => {
    const cdp = fakeCdp({
      "Runtime.evaluate": { result: { type: "object", subtype: "null", value: null } },
    });
    await assert.rejects(uploadAt(cdp, 1, 1, file, 5), /no file picker and no file input/);
  });

  it("says so when the page does not take the file", async () => {
    const cdp = fakeCdp({
      "Runtime.evaluate": { result: { objectId: "input-1" } },
      "Runtime.callFunctionOn": { result: { value: { name: "", size: 0 } } },
    });
    await assert.rejects(uploadAt(cdp, 1, 1, file, 5), /did not take the file/);
  });
});

describe("toBase64", () => {
  it("encodes bytes, including a file larger than one piece", () => {
    assert.equal(toBase64(new TextEncoder().encode("ABC").buffer), "QUJD");
    const big = new Uint8Array(100_000).fill(65);
    assert.equal(atob(toBase64(big.buffer)), "A".repeat(100_000));
  });
});
