import { ApiError } from "./client";

const UNAUTHORIZED = 401;
/** The Server-Timing metric for the time the console spent waiting on acorn-backend. */
const UPSTREAM_TIMING = "upstream";

/**
 * Wraps a route handler that answers with JSON: a null result is a 404, a failure is a 502
 * with the API's message (a 401 stays a 401, so the browser goes to sign-in), and the
 * browser caches nothing (the client cache decides). The time spent on acorn-backend goes back
 * as a Server-Timing metric, so a slow claim shows where it waited in the Network panel.
 */
export function jsonRoute<Ctx>(load: (request: Request, ctx: Ctx) => Promise<unknown>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    const started = performance.now();
    try {
      const body = await load(request, ctx);
      if (body === null || body === undefined)
        return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(body, {
        headers: {
          "Cache-Control": "no-store",
          "Server-Timing": `${UPSTREAM_TIMING};dur=${(performance.now() - started).toFixed(1)}`,
        },
      });
    } catch (err) {
      const status = err instanceof ApiError && err.status === UNAUTHORIZED ? UNAUTHORIZED : 502;
      return Response.json(
        { error: err instanceof Error ? err.message : "Request failed" },
        { status },
      );
    }
  };
}
