// A stand-in for OpenRouter's chat API. It plays a model that reads the form correctly:
// each step it is asked for, it answers with the next scripted actions, at the points of
// the controls it was told about. It checks, on every request, that the agent sent what a
// real model would need: the screenshot, the applicant, the memory, and the last results.

export type Point = { x: number; y: number };
export type Points = Record<"name" | "email" | "auth" | "agree" | "upload" | "submit", Point> &
  Partial<Record<"dropbox" | "import", Point>>;

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
  check: null,
};
const act = (kind: string, fields: Record<string, unknown> = {}) => ({ ...NULLS, kind, ...fields });
export const click = (p: Point) => act("click", p);
export const typeInto = (text: string) => act("type", { text });
export const key = (keys: string) => act("key", { keys });
export const upload = (p: Point) => act("upload", p);
/** An action with what the screen should show once it has run, for the decision model to check. */
export const checked = (action: Record<string, unknown>, expect: string) => ({
  ...action,
  check: expect,
});

export function answer(fields: Record<string, unknown>) {
  return {
    observation: "I see the form",
    memo: "filling it in",
    job: "Data Engineer",
    message: "Working",
    stop: null,
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

export type Verdict = { matches: number; blocked: number; loading: number };
export type DecisionRequest = {
  model: string;
  /** The screen checker sends parts (text and an image); Jev sends one string. */
  state: string | { type: string; text?: string; image_url?: { url: string } }[];
  questions: Record<
    string,
    { type: string; instructions: string; criteria?: Record<string, string> }
  >;
};
export const decisionRequests: DecisionRequest[] = [];

/** A stand-in for OpenRouter's Decisions API: answers every check with the verdict it is given. */
export function startFakeDecisions(verdict: () => Verdict) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      // The agent opens its connection with a bodiless HEAD when it starts.
      if (req.method !== "POST") return new Response("");
      const request = (await req.json()) as DecisionRequest;
      decisionRequests.push(request);
      const v = verdict();
      const answers: Record<string, unknown> = {};
      for (const [key, question] of Object.entries(request.questions)) {
        if (key === "job_description") {
          // Jev reads the page text: a description when it says it is hiring.
          const text = typeof request.state === "string" ? request.state : "";
          answers[key] = { type: "noul", noul: text.includes("We are hiring") ? 0.97 : 0.02 };
        } else if (key === "online_source") {
          // The decision model judges a control, window or frame: an online file source when it is a
          // Dropbox button, or a chooser page. (A test stand-in: the real model reads the description.)
          const text = typeof request.state === "string" ? request.state : "";
          answers[key] = { type: "noul", noul: /Dropbox|chooser/i.test(text) ? 0.95 : 0.02 };
        } else if (question.type === "choice") {
          const first = Object.keys(question.criteria ?? {})[0] ?? "";
          answers[key] = { type: "choice", choice: first, probabilities: { [first]: 0.99 } };
        } else {
          answers[key] = { type: "noul", noul: v[key as keyof Verdict] };
        }
      }
      return Response.json({
        model: "fake/decisions",
        answers,
        usage: { input_tokens: 1200, output_tokens: 0, cost: 0.0002 },
      });
    },
  });
}
