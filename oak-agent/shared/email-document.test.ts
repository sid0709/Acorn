import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEmailDocument, hasRemoteImages } from "./email-document.ts";

describe("buildEmailDocument", () => {
  it("blocks remote images unless asked", () => {
    const blocked = buildEmailDocument({ html: "<p>Hi</p>", text: "" }, false);
    assert.ok(blocked.includes("img-src data:;"));
    assert.ok(!blocked.includes("https:"));
    const open = buildEmailDocument({ html: "<p>Hi</p>", text: "" }, true);
    assert.ok(open.includes("img-src data: https: http:"));
  });

  it("opens links in a new tab and keeps the email's own html", () => {
    const doc = buildEmailDocument(
      { html: "<a href='https://x.test'>Verify</a>", text: "" },
      false,
    );
    assert.ok(doc.includes('<base target="_blank">'));
    assert.ok(doc.includes("<a href='https://x.test'>Verify</a>"));
  });

  it("falls back to the text, escaped", () => {
    const doc = buildEmailDocument({ html: "  ", text: "Code <123456> & more" }, false);
    assert.ok(doc.includes("<pre>Code &lt;123456&gt; &amp; more</pre>"));
  });

  it("removes a page-redirecting meta refresh", () => {
    const doc = buildEmailDocument(
      { html: '<meta http-equiv="refresh" content="0;url=https://evil.test"><p>x</p>', text: "" },
      false,
    );
    assert.ok(!doc.includes("evil.test"));
  });
});

describe("hasRemoteImages", () => {
  it("sees images and css backgrounds on the web, not inline ones", () => {
    assert.equal(hasRemoteImages('<img src="https://t.test/p.gif">'), true);
    assert.equal(hasRemoteImages('<div style="background:url(https://t.test/b.png)">'), true);
    assert.equal(hasRemoteImages('<img src="data:image/png;base64,AAAA">'), false);
    assert.equal(hasRemoteImages("<p>none</p>"), false);
  });
});
