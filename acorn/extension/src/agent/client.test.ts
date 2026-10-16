import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ACORN_AGENT_LOOPBACK_ORIGIN } from "@acorn/shared/api";

import {
  AgentApiError,
  endSession,
  fetchResumeFile,
  isRetryable,
  sendStep,
  startSession,
} from "./client.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Seen = { url: string; init: RequestInit };

function stub(respond: (seen: Seen) => Response | Promise<Response>): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const entry = { url: String(url), init: init ?? {} };
    seen.push(entry);
    return respond(entry);
  }) as typeof fetch;
  return seen;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("startSession", () => {
  it("posts the page and sends the person's key when there is one", async () => {
    const seen = stub(() => json({ sessionId: "s1", resumes: [] }));
    const started = await startSession(
      "http://agent",
      { url: "https://jobs.example", title: "Apply", stopBeforeSubmit: true },
      "sk-mine",
    );
    assert.equal(started.sessionId, "s1");
    assert.equal(seen[0].url, "http://agent/agent/v1/sessions");
    assert.equal(seen[0].init.method, "POST");
    assert.equal((seen[0].init.headers as Record<string, string>)["X-OpenRouter-Key"], "sk-mine");
    assert.deepEqual(JSON.parse(String(seen[0].init.body)), {
      url: "https://jobs.example",
      title: "Apply",
      stopBeforeSubmit: true,
    });
  });

  it("sends the person's Acorn session as a bearer token, so the agent can read their profile", async () => {
    const seen = stub(() => json({ sessionId: "s1", resumes: [] }));
    await startSession(
      "http://agent",
      { url: "", title: "", stopBeforeSubmit: false },
      undefined,
      "session-token",
    );
    const headers = seen[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer session-token");
    assert.equal("X-OpenRouter-Key" in headers, false);
  });

  it("sends no Authorization when the person is not signed in", async () => {
    const seen = stub(() => json({ sessionId: "s1", resumes: [] }));
    await startSession("http://agent", { url: "", title: "", stopBeforeSubmit: false });
    assert.equal("Authorization" in (seen[0].init.headers as Record<string, string>), false);
  });

  it("sends no key header when it has none", async () => {
    const seen = stub(() => json({ sessionId: "s1", resumes: [] }));
    await startSession("http://agent", { url: "", title: "", stopBeforeSubmit: false });
    assert.equal("X-OpenRouter-Key" in (seen[0].init.headers as Record<string, string>), false);
  });
});

describe("errors", () => {
  it("keeps the server's code and words", async () => {
    stub(() =>
      json(
        {
          error: "profile.json is missing or empty: put it at data/profile.json",
          code: "no_profile",
        },
        422,
      ),
    );
    await assert.rejects(
      startSession("http://agent", { url: "", title: "", stopBeforeSubmit: false }),
      (err: unknown) =>
        err instanceof AgentApiError &&
        err.code === "no_profile" &&
        err.status === 422 &&
        /profile\.json/.test(err.message),
    );
  });

  it("says the agent is unreachable when nothing answers", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await assert.rejects(
      startSession(ACORN_AGENT_LOOPBACK_ORIGIN, { url: "", title: "", stopBeforeSubmit: false }),
      (err: unknown) =>
        err instanceof AgentApiError &&
        err.code === "unreachable" &&
        err.message.includes(`Can't reach the Acorn agent at ${ACORN_AGENT_LOOPBACK_ORIGIN}`),
    );
  });

  it("copes with an answer that is not JSON", async () => {
    stub(() => new Response("<html>bad gateway</html>", { status: 502 }));
    await assert.rejects(
      startSession("http://agent", { url: "", title: "", stopBeforeSubmit: false }),
      (err: unknown) => err instanceof AgentApiError && err.status === 502 && err.code === "error",
    );
  });

  it("passes the person's Stop through as an abort, not as a server failure", async () => {
    const controller = new AbortController();
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      return json({});
    }) as typeof fetch;
    const observation = {
      screenshot: "",
      url: "",
      title: "",
      viewport: { width: 1, height: 1, scrollX: 0, scrollY: 0, pageWidth: 1, pageHeight: 1 },
    };
    await assert.rejects(
      sendStep("http://agent", "s1", observation, controller.signal),
      (err: unknown) => !(err instanceof AgentApiError),
    );
  });

  it("retries only what a second try can fix", () => {
    for (const code of ["rate_limited", "model_error", "network", "unreachable", "bad_request"]) {
      assert.equal(isRetryable(new AgentApiError("x", code)), true, code);
    }
    for (const code of [
      "no_key",
      "invalid_key",
      "no_credits",
      "no_profile",
      "no_session",
      "bad_observation",
    ]) {
      assert.equal(isRetryable(new AgentApiError("x", code)), false, code);
    }
    assert.equal(isRetryable(new Error("boom")), false);
  });
});

describe("sendStep", () => {
  it("posts the observation to the session's step route", async () => {
    const seen = stub(() =>
      json({
        status: "working",
        message: "ok",
        actions: [],
        number: 1,
        usage: { calls: 1, inputTokens: 1, outputTokens: 1, cost: 0 },
      }),
    );
    const observation = {
      screenshot: "data:image/jpeg;base64,AA==",
      url: "u",
      title: "t",
      viewport: { width: 10, height: 10, scrollX: 0, scrollY: 0, pageWidth: 10, pageHeight: 10 },
    };
    const step = await sendStep("http://agent", "a b", observation, new AbortController().signal);
    assert.equal(step.status, "working");
    assert.equal(seen[0].url, "http://agent/agent/v1/sessions/a%20b/step");
  });
});

describe("endSession", () => {
  it("never fails the run", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    await endSession("http://agent", "s1");
  });
});

describe("fetchResumeFile", () => {
  it("returns the bytes, the type, and the name the server gave", async () => {
    const seen = stub(
      () =>
        new Response(new TextEncoder().encode("ABC"), {
          headers: { "Content-Type": "application/pdf", "X-File-Name": "Ada.pdf" },
        }),
    );
    const file = await fetchResumeFile(
      "http://agent",
      "s1",
      "data/Ada.pdf",
      "x",
      new AbortController().signal,
      (bytes) => String(bytes.byteLength),
    );
    assert.deepEqual(file, { fileName: "Ada.pdf", contentType: "application/pdf", base64: "3" });
    assert.equal(seen[0].url, "http://agent/agent/v1/sessions/s1/resume?id=data%2FAda.pdf");
  });
});
