// A stand-in for OpenRouter's chat API. It plays a model that reads the form correctly:
// each step it is asked for, it answers with the next scripted actions, at the points of
// the controls it was told about. It checks, on every request, that the agent sent what a
// real model would need: the screenshot, the applicant, the memory, and the last results.

export type Point = { x: number; y: number };
export type Points = Record<"name" | "email" | "auth" | "agree" | "upload" | "submit", Point>;

export type ModelRequest = {
  messages: {
    role: string;
    content: string | { type: string; text?: string; image_url?: { url: string } }[];
  }[];
  response_format?: { type: string; json_schema?: { name: string; strict: boolean } };
};

export type Script = (step: number, points: Points) => Record<string, unknown>;

const NULLS = {
  x: null,
  y: null,
  text: null,
  secret: null,
  keys: null,
  dx: null,
  dy: null,
  ms: null,
  resume: null,
};
const act = (kind: string, fields: Record<string, unknown> = {}) => ({ ...NULLS, kind, ...fields });
export const click = (p: Point) => act("click", p);
export const typeInto = (text: string) => act("type", { text });
export const key = (keys: string) => act("key", { keys });
export const upload = (p: Point) => act("upload", p);

export function answer(fields: Record<string, unknown>) {
  return {
    observation: "I see the form",
    memo: "filling it in",
    job: "Data Engineer",
    message: "Working",
    actions: [],
    ...fields,
  };
}

export const requests: ModelRequest[] = [];

function stepOf(request: ModelRequest): number {
  const last = request.messages.at(-1);
  const text =
    typeof last?.content === "string"
      ? last.content
      : (last?.content.find((p) => p.type === "text")?.text ?? "");
  const match = /^Step (\d+) of/m.exec(text);
  if (!match) throw new Error("the last message is not a step observation");
  return Number(match[1]);
}

export function startFakeModel(points: () => Points, script: Script) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const request = (await req.json()) as ModelRequest;
      requests.push(request);
      const step = stepOf(request);
      const reply = script(step, points());
      return Response.json({
        model: "fake/luna",
        choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 50, cost: 0.001 },
      });
    },
  });
}
