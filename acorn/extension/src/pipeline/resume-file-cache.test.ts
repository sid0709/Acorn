import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cachedResumeFile } from "./resume-file-cache.ts";

import type { RuntimeAttachedFile } from "@acorn/shared/plan-runner/types";

const file = (name: string) => ({ name, base64: "eA==" }) as RuntimeAttachedFile;

describe("cachedResumeFile", () => {
  it("shares a load still in flight: the fill joins the prefetch", async () => {
    let fetches = 0;
    let release: (value: RuntimeAttachedFile) => void = () => undefined;
    const load = () => {
      fetches += 1;
      return new Promise<RuntimeAttachedFile>((resolve) => {
        release = resolve;
      });
    };
    const prefetch = cachedResumeFile("library:shared", load);
    const fill = cachedResumeFile("library:shared", load);
    release(file("Resume.pdf"));
    assert.equal((await prefetch)?.name, "Resume.pdf");
    assert.equal((await fill)?.name, "Resume.pdf");
    assert.equal(fetches, 1);
  });

  it("asks again after a load that found nothing or failed", async () => {
    let fetches = 0;
    assert.equal(await cachedResumeFile("library:empty", async () => (fetches++, null)), null);
    await cachedResumeFile("library:empty", async () => (fetches++, file("Later.pdf")));
    assert.equal(fetches, 2);
    await assert.rejects(cachedResumeFile("library:broken", () => Promise.reject(new Error("x"))));
    assert.equal(
      (await cachedResumeFile("library:broken", async () => file("Ok.pdf")))?.name,
      "Ok.pdf",
    );
  });
});
