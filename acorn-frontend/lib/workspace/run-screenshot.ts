import { ACORN_RUNS_API } from "@acorn/shared/runs";

import { sessionToken } from "@/lib/auth/cookie";
import { acornHeaders } from "@/lib/auth/headers";
import { acornApiUrl } from "@/lib/config";

/** The browser reads a Run's image from this site; the route below adds the session. */
export function runScreenshotSrc(id: string): string {
  return `/api/runs/${encodeURIComponent(id)}/screenshot`;
}

const UNREACHABLE = "Couldn’t reach Acorn. Check that the API is running.";

/** An image stays the same once stored; the browser may keep it as long as acorn-backend says. */
const NOT_FOUND = 404;

/** Server-only: forwards a Run's screenshot read to acorn-backend as the signed-in person. */
export async function proxyRunScreenshot(id: string): Promise<Response> {
  const token = await sessionToken();
  if (!token) return Response.json({ message: "Sign in required." }, { status: 401 });
  const response = await fetch(`${acornApiUrl()}${ACORN_RUNS_API.screenshot(id)}`, {
    headers: acornHeaders(token),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return Response.json({ message: UNREACHABLE }, { status: 502 });
  if (!response.ok) {
    return new Response(null, { status: response.status === NOT_FOUND ? NOT_FOUND : 502 });
  }
  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": response.headers.get("Cache-Control") ?? "private, no-store",
    },
  });
}
