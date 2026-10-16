import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recordAgentTrace } from "./trace-log.ts";

function sink() {
  const files: [string, string][] = [];
  return { files, agentFile: (name: string, content: string) => void files.push([name, content]) };
}

describe("recordAgentTrace", () => {
  it("keeps the screenshots the extension took, named like the server's files", () => {
    const log = sink();
    recordAgentTrace(
      log,
      { seq: 3, files: [{ name: "003.json", text: "{}" }], timeline: "003 step\n" },
      {
        seq: 3,
        screenshot: "data:image/jpeg;base64,AAAA",
        survey: [{ screenshot: "data:image/jpeg;base64,BBBB", scrollY: 0 }],
      },
    );
    assert.deepEqual(log.files, [
      ["003.jpg", "AAAA"],
      ["003.survey1.jpg", "BBBB"],
      ["003.json", "{}"],
      ["timeline.txt", "003 step\n"],
    ]);
  });

  it("keeps an image of the server as its base64 and copes with a server that sent no trace", () => {
    const log = sink();
    recordAgentTrace(log, { files: [{ name: "003.marked.jpg", data: "CCCC" }] });
    recordAgentTrace(log, undefined, { seq: 4, screenshot: "data:image/png;base64,DDDD" });
    assert.deepEqual(log.files, [
      ["003.marked.jpg", "CCCC"],
      ["004.png", "DDDD"],
    ]);
  });
});
