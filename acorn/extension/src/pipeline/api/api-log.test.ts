import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeNetworkError, redactForLog } from "./api-log.ts";

describe("redactForLog", () => {
  it("hides secrets at any depth and leaves the rest whole", () => {
    const out = redactForLog({
      text: "the page",
      nested: { Password: "p", list: [{ verificationCode: "123456", keep: 1 }] },
      authorization: "Bearer x",
    });
    assert.deepEqual(out, {
      text: "the page",
      nested: { Password: "(hidden)", list: [{ verificationCode: "(hidden)", keep: 1 }] },
      authorization: "(hidden)",
    });
  });

  it("hides the extra keys a call names, and does not change the original", () => {
    const original = { value: "https://site/verify?code=abc", status: "found" };
    assert.deepEqual(redactForLog(original, ["value"]), { value: "(hidden)", status: "found" });
    assert.equal(original.value, "https://site/verify?code=abc");
  });
});

describe("describeNetworkError", () => {
  it("names an unreachable server and a timeout in plain words", () => {
    assert.match(describeNetworkError(new TypeError("Failed to fetch")), /Could not reach/);
    assert.match(
      describeNetworkError(new DOMException("signal timed out", "TimeoutError")),
      /took too long/,
    );
  });
});
