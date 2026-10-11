import { CLAIM_EVENTS_PATH } from "@/lib/api/claims";
import { adminFetch, readApiError } from "@/lib/api/client";

/**
 * acorn-backend's claim events, passed through as they arrive. The browser's EventSource
 * reaches this route with the console's cookie; the admin token never leaves the server.
 */
export async function GET(request: Request): Promise<Response> {
  const upstream = await adminFetch(CLAIM_EVENTS_PATH, {
    headers: { Accept: "text/event-stream" },
    signal: request.signal,
  }).catch(() => null);
  if (!upstream) return Response.json({ error: "Claim events are unavailable" }, { status: 502 });
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: await readApiError(upstream) }, { status: upstream.status });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      // no-transform keeps compression from holding events back.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
