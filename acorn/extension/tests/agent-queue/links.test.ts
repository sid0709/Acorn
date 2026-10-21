import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkLabel, parseJobLinks } from "../../src/agent-queue/links.ts";

describe("reading pasted job links", () => {
  it("takes the part of each line before the first space, so a title after it is ignored", () => {
    const parsed = parseJobLinks(
      [
        "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=1&jobId=2 | Recruitment",
        "https://myjobs.adp.com/inspiracareers/cx/job-details?reqId=5 | myjobs.adp.com/x",
        "https://boards.example.com/acme/jobs/42",
      ].join("\n"),
    );
    assert.deepEqual(parsed.links, [
      "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=1&jobId=2",
      "https://myjobs.adp.com/inspiracareers/cx/job-details?reqId=5",
      "https://boards.example.com/acme/jobs/42",
    ]);
    assert.equal(parsed.invalid, 0);
    assert.equal(parsed.duplicates, 0);
  });

  it("skips blank lines, handles Windows line breaks and tabs, and counts what is not a link", () => {
    const parsed = parseJobLinks(
      "\r\n  https://a.example.com/x\t| tab title\r\n\r\nnot a link\r\nftp://a.example.com/f\r\njavascript:alert(1)\r\n",
    );
    assert.deepEqual(parsed.links, ["https://a.example.com/x"]);
    assert.equal(parsed.invalid, 3);
  });

  it("counts a repeated link, and one already queued, once", () => {
    const parsed = parseJobLinks(
      "https://a.example.com/x\nhttps://a.example.com/x | again\nhttps://b.example.com/y",
      ["https://b.example.com/y"],
    );
    assert.deepEqual(parsed.links, ["https://a.example.com/x"]);
    assert.equal(parsed.duplicates, 2);
  });

  it("refuses a link longer than the backend keeps", () => {
    const parsed = parseJobLinks(`https://a.example.com/${"x".repeat(3000)}`);
    assert.deepEqual(parsed.links, []);
    assert.equal(parsed.invalid, 1);
  });
});

describe("naming a job in the list", () => {
  it("shows the host and path without the query, cut when long", () => {
    assert.equal(
      linkLabel("https://boards.example.com/acme/jobs/42?gh_jid=42"),
      "boards.example.com/acme/jobs/42",
    );
    assert.equal(linkLabel("https://a.example.com/"), "a.example.com");
    const long = linkLabel(`https://a.example.com/${"x".repeat(200)}`);
    assert.equal(long.length, 56);
    assert.ok(long.endsWith("…"));
  });
});
