import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import { AGENT_ERROR_CODE, type AgentObservation } from "@acorn/shared/agent-contract";

import {
  AgentApiError,
  fetchResumeFile,
  preloadImage,
  sendShot,
  sendStep,
  startSession,
} from "../../src/agent/client.ts";
import { blobRef } from "../../src/agent/image-refs.ts";
import { forgetTransport } from "../../src/agent/transport.ts";

const BASE = "http://agent.test";
/** Pictures long enough to be packed (GZIP_MIN_BYTES). */
const SHOT = `data:image/jpeg;base64,${"A".repeat(3000)}`;
const SCREEN = `data:image/jpeg;base64,${"B".repeat(3000)}`;
const hashOf = (dataUrl: string) => createHash("sha256").update(dataUrl).digest("hex");

type Seen = {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
  encoding: string | null;
};

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** A stand-in agent: it unpacks gzip, answers what the test says, and remembers every request. */
class FakeAgent {
  readonly seen: Seen[] = [];
  /** Answers by route suffix, taken in order; a route with none left answers ok. */
  readonly answers = new Map<string, { status: number; body: unknown }[]>();
  transport: { gzip?: boolean; blobs?: boolean } | undefined = { gzip: true, blobs: true };
  private readonly before: typeof fetch;

  constructor() {
    this.before = globalThis.fetch;
    globalThis.fetch = (input, init) => this.handle(urlOf(input), init);
  }

  restore(): void {
    globalThis.fetch = this.before;
  }

  answer(route: string, status: number, body: unknown): void {
    this.answers.set(route, [...(this.answers.get(route) ?? []), { status, body }]);
  }

  private async handle(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    const encoding = headers.get("Content-Encoding");
    let body: unknown;
    if (init?.body) {
      const raw = init.body as Uint8Array<ArrayBuffer>;
      const text =
        encoding === "gzip"
          ? await new Response(
              new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip")),
            ).text()
          : new TextDecoder().decode(raw);
      body = JSON.parse(text);
    }
    this.seen.push({ url, method: init?.method ?? "GET", headers, body, encoding });
    const route = url.slice(url.lastIndexOf("/"));
    const scripted = this.answers.get(route)?.shift();
    if (scripted) {
      return new Response(JSON.stringify(scripted.body), {
        status: scripted.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (route === "/sessions") {
      return Response.json({ sessionId: "run1", resumes: [], transport: this.transport });
    }
    if (route === "/step") {
      return Response.json({ status: "working", message: "ok", actions: [], number: 1, usage: {} });
    }
    if (route === "/blobs") {
      const upload = body as { images: string[] };
      return Response.json({ hashes: upload.images.map(hashOf) });
    }
    if (route.startsWith("/resume")) {
      return new Response("%PDF", {
        headers: { "Content-Type": "application/pdf", "X-File-Name": "Ada.pdf" },
      });
    }
    return Response.json({ ok: true });
  }
}

function look(over: Partial<AgentObservation> = {}): AgentObservation {
  return {
    screenshot: SHOT,
    url: "https://jobs.example",
    title: "Apply",
    viewport: {
      width: 1280,
      height: 800,
      scrollX: 0,
      scrollY: 0,
      pageWidth: 1280,
      pageHeight: 800,
    },
    ...over,
  };
}

describe("the agent client over a slow line", () => {
  let agent: FakeAgent;
  const signal = new AbortController().signal;
  beforeEach(() => {
    agent = new FakeAgent();
  });
  afterEach(() => {
    agent.restore();
    forgetTransport("run1");
  });

  it("packs a long body once the server has said it unpacks, and sends a held picture as a reference", async () => {
    const started = await startSession(BASE, {
      url: "https://jobs.example",
      title: "Apply",
      stopBeforeSubmit: false,
    });
    assert.equal(started.sessionId, "run1");
    // The start itself goes plain: the server has not said anything yet.
    assert.equal(agent.seen[0]?.encoding, null);

    const timings: number[] = [];
    await sendStep(
      BASE,
      "run1",
      look({
        survey: [
          { screenshot: SHOT, scrollY: 0 },
          { screenshot: SCREEN, scrollY: 800 },
        ],
      }),
      signal,
      (timing) => {
        timings.push(timing.requestBytes, timing.rawRequestBytes ?? 0);
      },
    );
    const first = agent.seen[1];
    assert.equal(first.encoding, "gzip");
    const sent = first.body as AgentObservation;
    // The screenshot went as bytes, and the survey screen that is the same picture as a reference.
    assert.equal(sent.screenshot, SHOT);
    assert.equal(sent.survey?.[0]?.screenshot, blobRef(hashOf(SHOT)));
    assert.equal(sent.survey?.[1]?.screenshot, SCREEN);
    assert.ok(
      timings[0] < timings[1],
      `packed ${timings[0]} should be less than raw ${timings[1]}`,
    );

    // The next look: both pictures are held now.
    await sendStep(
      BASE,
      "run1",
      look({
        survey: [
          { screenshot: SHOT, scrollY: 0 },
          { screenshot: SCREEN, scrollY: 800 },
        ],
      }),
      signal,
    );
    const second = agent.seen[2].body as AgentObservation;
    assert.equal(second.screenshot, blobRef(hashOf(SHOT)));
    assert.equal(second.survey?.[1]?.screenshot, blobRef(hashOf(SCREEN)));
  });

  it("sends everything as bytes, unpacked, to a server that offered nothing", async () => {
    agent.transport = undefined;
    await startSession(BASE, {
      url: "https://jobs.example",
      title: "Apply",
      stopBeforeSubmit: false,
    });
    await sendStep(BASE, "run1", look(), signal);
    await sendStep(BASE, "run1", look(), signal);
    for (const request of agent.seen.slice(1)) {
      assert.equal(request.encoding, null);
      assert.equal((request.body as AgentObservation).screenshot, SHOT);
    }
  });

  it("sends the pictures again as bytes when the server says it lost them", async () => {
    await startSession(BASE, {
      url: "https://jobs.example",
      title: "Apply",
      stopBeforeSubmit: false,
    });
    await sendStep(BASE, "run1", look(), signal);
    agent.answer("/step", 422, {
      error: "lost",
      code: AGENT_ERROR_CODE.missingBlobs,
      missing: [hashOf(SHOT)],
    });
    await sendStep(BASE, "run1", look(), signal);
    const [refused, resent] = agent.seen.slice(-2) as [Seen, Seen];
    assert.equal((refused.body as AgentObservation).screenshot, blobRef(hashOf(SHOT)));
    assert.equal((resent.body as AgentObservation).screenshot, SHOT);
    // A server that keeps saying so gets the look as bytes alone, then the failure stands.
    agent.answer("/step", 422, {
      error: "lost",
      code: AGENT_ERROR_CODE.missingBlobs,
      missing: [hashOf(SHOT)],
    });
    agent.answer("/step", 422, {
      error: "lost",
      code: AGENT_ERROR_CODE.missingBlobs,
      missing: [hashOf(SHOT)],
    });
    agent.answer("/step", 422, {
      error: "lost",
      code: AGENT_ERROR_CODE.missingBlobs,
      missing: [hashOf(SHOT)],
    });
    await assert.rejects(
      sendStep(BASE, "run1", look(), signal),
      (err: unknown) => err instanceof AgentApiError && err.code === AGENT_ERROR_CODE.missingBlobs,
    );
    assert.equal(agent.seen.filter((request) => request.url.endsWith("/step")).length, 6);
  });

  it("waits for a picture on its way and refers to it, instead of carrying it again", async () => {
    await startSession(BASE, {
      url: "https://jobs.example",
      title: "Apply",
      stopBeforeSubmit: false,
    });
    // A survey screen sent ahead and a zone photo sent mid-batch, both still in flight when the look is sent.
    preloadImage(BASE, "run1", SCREEN, signal);
    const photo = sendShot(
      BASE,
      "run1",
      { kind: "zone", zone: 1, screenshot: SHOT, scrollY: 0 },
      signal,
      undefined,
      "background",
    );
    const step = await sendStep(
      BASE,
      "run1",
      look({
        survey: [
          { screenshot: SHOT, scrollY: 0 },
          { screenshot: SCREEN, scrollY: 800 },
        ],
        zoneShots: [{ zone: 1, screenshot: SHOT, scrollY: 0 }],
      }),
      signal,
    );
    await photo;
    assert.equal(step.status, "working");
    const routes = agent.seen.map((request) => request.url.slice(request.url.lastIndexOf("/")));
    assert.deepEqual(routes, ["/sessions", "/blobs", "/shots", "/step"]);
    const sent = agent.seen[3].body as AgentObservation;
    assert.equal(sent.screenshot, blobRef(hashOf(SHOT)));
    assert.equal(sent.survey?.[1]?.screenshot, blobRef(hashOf(SCREEN)));
    assert.equal(sent.zoneShots?.[0]?.screenshot, blobRef(hashOf(SHOT)));
  });

  it("fetches a file with time for its size and never packs the request", async () => {
    await startSession(BASE, {
      url: "https://jobs.example",
      title: "Apply",
      stopBeforeSubmit: false,
    });
    const file = await fetchResumeFile(
      BASE,
      "run1",
      "r1",
      "Ada.pdf",
      signal,
      () => "base64",
      undefined,
      250_000,
    );
    assert.equal(file.fileName, "Ada.pdf");
    assert.equal(agent.seen.at(-1)?.encoding, null);
  });
});
